import { Prisma } from "@prisma/client";
import dns from "node:dns/promises";
import net from "node:net";
import { classifyDatabaseError } from "@/lib/database-error-classifier";
import { getDbEnvStatus, sanitizeFailureDetail, type DbConnectionMode } from "@/lib/db-env-validation";
import { DAILY_JOB_SLA_MINUTES, getIstanbulWallClock, toIstanbulDateKey } from "@/lib/daily-sync-policy";
import {
  areRuntimeTargetsIdentical,
  getDbRuntimeTargetDiagnostics,
  type DbRuntimeTargetDiagnostics,
} from "@/lib/db-runtime-diagnostics";
import { resolveHealthDbFailureCategory } from "@/lib/health-db-diagnostics";
import { getEffectiveDatabaseUrl, prisma } from "@/lib/prisma";
import { getFundDetailCoreServingReadiness } from "@/lib/services/fund-detail-core-serving.service";
import { fetchSupabaseRestJson, hasSupabaseRestConfig } from "@/lib/supabase-rest";
import {
  filterExpectedHealthDiagnosticErrors,
  healthDbPingFailureLogLevel,
  resolveHealthDbPingSoftBudgetMs,
  shouldRunExternalDbFailureProbes,
} from "@/lib/operational-hardening";

export type SystemHealthStatus = "ok" | "degraded" | "error";
export type SystemHealthIssueSeverity = "warning" | "error";
type HealthDbPingSource =
  | "query"
  | "cache_hit"
  | "cache_inflight"
  | "query_failed"
  | "cache_failed";

const HEALTH_DB_PING_CACHE_TTL_MS = Number(process.env.HEALTH_DB_PING_CACHE_TTL_MS ?? "25000");
const HEALTH_DB_PING_FAILURE_TTL_MS = Number(process.env.HEALTH_DB_PING_FAILURE_TTL_MS ?? "60000");
const HEALTH_DB_PING_MAX_WAIT_MS = Number(process.env.HEALTH_DB_PING_MAX_WAIT_MS ?? "900");
const HEALTH_DB_PING_TX_TIMEOUT_MS = Number(process.env.HEALTH_DB_PING_TX_TIMEOUT_MS ?? "1800");
const HEALTH_DB_PING_SOFT_TIMEOUT_MS = Number(process.env.HEALTH_DB_PING_SOFT_TIMEOUT_MS ?? "3000");
const HEALTH_DB_PING_LIGHT_SOFT_TIMEOUT_MS = Number(process.env.HEALTH_DB_PING_LIGHT_SOFT_TIMEOUT_MS ?? "650");

export interface SystemHealthIssue {
  code: string;
  severity: SystemHealthIssueSeverity;
  message: string;
}

export interface SystemHealthSnapshot {
  checkedAt: string;
  ok: boolean;
  status: SystemHealthStatus;
  database: {
    configured: boolean;
    engine: "postgresql" | "unknown";
    canConnect: boolean;
    connectionMode: DbConnectionMode;
    envStatus: ReturnType<typeof getDbEnvStatus>;
    dbUrlPreview: string;
    effectiveDbUrlPreview: string;
    effectiveHost: string | null;
    effectivePort: number | null;
    effectiveParams: Record<string, string>;
    dnsMs: number | null;
    tcpMs: number | null;
    diagnostics: {
      targets: DbRuntimeTargetDiagnostics[];
      identicalAcrossPaths: boolean;
      failureCategory: string | null;
      failureDetail: string | null;
      queryFailureSummary: Record<string, number>;
      pingSource: HealthDbPingSource;
      pingMs: number | null;
      readPathOperational: boolean;
    };
  };
  supabaseRest: {
    configured: boolean;
    host: string | null;
    ok: boolean;
    status: number | null;
    latencyMs: number | null;
    error: string | null;
    dnsMs: number | null;
    tcpMs: number | null;
  };
  serving: {
    detailCore: {
      filePath: string;
      fileExists: boolean;
      fileRecordCount: number;
      fileMissReason: "file_missing" | "file_empty" | "file_parse_error" | null;
      dbCacheCount: number | null;
      dbMissReason: "cache_empty" | "build_failed" | null;
      bootstrap: {
        inFlight: boolean;
        status: "idle" | "running" | "ok" | "failed";
        lastStartedAt: string | null;
        lastCompletedAt: string | null;
        lastReason: string | null;
        lastError: string | null;
      };
    };
  };
  counts: {
    funds: number;
    activeFunds: number;
    categories: number;
    fundTypes: number;
    derivedMetrics: number;
    dailySnapshots: number;
    marketSnapshots: number;
    macroSeries: number;
    macroObservations: number;
  };
  freshness: {
    latestFundSnapshotDate: string | null;
    latestMarketSnapshotDate: string | null;
    latestMacroObservationDate: string | null;
    latestFundUpdateAt: string | null;
    latestSnapshotCoverageDate: string | null;
    lastSuccessfulIngestionAt: string | null;
    lastPublishedSnapshotAt: string | null;
    daysSinceLatestFundSnapshot: number | null;
    daysSinceLatestMarketSnapshot: number | null;
    daysSinceLatestMacroObservation: number | null;
  };
  integrity: {
    activeFundsMissingCategory: number;
    activeFundsMissingFundType: number;
    activeFundsInvalidLastPrice: number;
    activeFundsWithoutDailySnapshotOnLatestDate: number;
    activeFundsWithoutDerivedMetrics: number;
    latestSnapshotCoverage: number | null;
    latestSnapshotCoverageGap: number | null;
    macroSyncStatus: string | null;
  };
  jobs: {
    sourceRefresh: SystemHealthJobSnapshot | null;
    servingRebuild: SystemHealthJobSnapshot | null;
    warmScores: SystemHealthJobSnapshot | null;
    dailySync: SystemHealthJobSnapshot | null;
    dailySyncStatus: DailySyncStatusView | null;
  };
  issues: SystemHealthIssue[];
  errors: string[];
}

export interface SystemHealthJobSnapshot {
  syncType: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
}

type DailySyncRunMeta = {
  phase?: string;
  runKey?: string;
  trigger?: string;
  sourceStatus?: string;
  publishStatus?: string;
  firstFailedStep?: string | null;
  failureKind?: "none" | "exception" | "timeout_suspected";
  staleRunRecovered?: boolean;
};

type DailySyncStatusView = {
  runKey: string | null;
  trigger: string | null;
  sourceStatus: "unknown" | "success" | "failed";
  publishStatus: "unknown" | "success" | "failed";
  firstFailedStep: string | null;
  failureKind: "none" | "exception" | "timeout_suspected" | "unknown";
  staleRunRecovered: boolean;
  missedSlaToday: boolean;
};

function parseDailySyncRunMeta(message: string | null | undefined): DailySyncRunMeta | null {
  if (!message) return null;
  try {
    const parsed = JSON.parse(message) as DailySyncRunMeta;
    return typeof parsed === "object" && parsed ? parsed : null;
  } catch {
    return null;
  }
}

function isRelationMissingError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

type HealthPingResult = {
  ok: boolean;
  ms: number;
  source: HealthDbPingSource;
  failureCategory: string | null;
  failureDetail: string | null;
};

type HealthPingState = {
  cached: { at: number; result: HealthPingResult } | null;
  inFlight: { promise: Promise<HealthPingResult>; startedAt: number } | null;
};

function getHealthPingState(): HealthPingState {
  const g = global as unknown as { __healthDbPingState?: HealthPingState };
  if (!g.__healthDbPingState) {
    g.__healthDbPingState = { cached: null, inFlight: null };
  }
  return g.__healthDbPingState;
}

async function probeDatabaseConnectivity(lightweight: boolean): Promise<HealthPingResult> {
  const state = getHealthPingState();
  const now = Date.now();
  const softBudgetMs = resolveHealthDbPingSoftBudgetMs({
    lightweight,
    defaultSoftBudgetMs: HEALTH_DB_PING_SOFT_TIMEOUT_MS,
    lightSoftBudgetMs: HEALTH_DB_PING_LIGHT_SOFT_TIMEOUT_MS,
  });
  const cached = state.cached;
  if (cached) {
    const ttl = cached.result.ok
      ? Math.max(5_000, HEALTH_DB_PING_CACHE_TTL_MS)
      : Math.max(2_000, HEALTH_DB_PING_FAILURE_TTL_MS);
    if (now - cached.at <= ttl) {
      return {
        ...cached.result,
        source: cached.result.ok ? "cache_hit" : "cache_failed",
      };
    }
  }

  if (state.inFlight) {
    const inflightElapsedMs = now - state.inFlight.startedAt;
    const remainingBudgetMs = softBudgetMs - inflightElapsedMs;
    if (remainingBudgetMs <= 0) {
      return {
        ok: false,
        ms: inflightElapsedMs,
        source: "cache_failed",
        failureCategory: "health_probe_soft_timeout",
        failureDetail: `health_db_ping_inflight_timeout_${softBudgetMs}ms`,
      };
    }
    const inflightBudgetMs = Math.max(100, remainingBudgetMs);
    const inflight = await Promise.race<HealthPingResult>([
      state.inFlight.promise,
      new Promise<HealthPingResult>((resolve) => {
        setTimeout(() => {
          resolve({
            ok: false,
            ms: inflightElapsedMs + inflightBudgetMs,
            source: "cache_failed",
            failureCategory: "health_probe_soft_timeout",
            failureDetail: `health_db_ping_inflight_timeout_${softBudgetMs}ms`,
          });
        }, inflightBudgetMs);
      }),
    ]);
    return {
      ...inflight,
      source: inflight.ok ? "cache_inflight" : "cache_failed",
    };
  }

  const probeStartedAt = Date.now();
  const task = (async (): Promise<HealthPingResult> => {
    const startedAt = probeStartedAt;
    try {
      const txMaxWaitMs = Math.max(100, Math.min(HEALTH_DB_PING_MAX_WAIT_MS, Math.floor(softBudgetMs / 2)));
      const txTimeoutMs = Math.max(250, Math.min(HEALTH_DB_PING_TX_TIMEOUT_MS, softBudgetMs));
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1`;
        },
        { maxWait: txMaxWaitMs, timeout: txTimeoutMs }
      );
      return {
        ok: true,
        ms: Date.now() - startedAt,
        source: "query",
        failureCategory: null,
        failureDetail: null,
      };
    } catch (error) {
      const classified = classifyDatabaseError(error);
      return {
        ok: false,
        ms: Date.now() - startedAt,
        source: "query_failed",
        failureCategory: classified.category,
        failureDetail: sanitizeFailureDetail(formatError(error)),
      };
    }
  })();

  const inFlightState = { promise: task, startedAt: now };
  state.inFlight = inFlightState;
  task
    .then((result) => {
      state.cached = { at: Date.now(), result };
    })
    .finally(() => {
      if (state.inFlight === inFlightState || !lightweight) {
        state.inFlight = null;
      }
    });

  const result = await Promise.race<HealthPingResult>([
    task,
    new Promise<HealthPingResult>((resolve) => {
      setTimeout(() => {
        resolve({
          ok: false,
          ms: Date.now() - probeStartedAt,
          source: "query_failed",
          failureCategory: "health_probe_soft_timeout",
          failureDetail: `health_db_ping_soft_timeout_${softBudgetMs}ms`,
        });
      }, softBudgetMs);
    }),
  ]);
  if (result.failureCategory === "health_probe_soft_timeout") {
    state.cached = { at: Date.now(), result };
  }
  return result;
}

function redactDatabaseUrl(urlStr: string): string {
  if (!urlStr) return "";
  try {
    return urlStr.replace(/\/\/([^/]*@)/, "//***:***@").split("?")[0] ?? urlStr;
  } catch {
    return "postgresql://(redacted)";
  }
}

function daysSince(date: Date | null | undefined): number | null {
  if (!date) return null;
  const diffMs = Date.now() - date.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 0;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

type RestDateRow = { date: string };

async function loadRestLatestDate(table: string): Promise<Date | null> {
  const rows = await fetchSupabaseRestJson<RestDateRow[]>(
    `${table}?select=date&order=date.desc&limit=1`,
    { revalidate: 300, timeoutMs: 1500, retries: 0 }
  );
  const raw = rows[0]?.date;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type ProbeResult = { ok: boolean; ms: number | null; error: string | null };

async function probeDns(host: string, timeoutMs: number): Promise<ProbeResult> {
  const startedAt = Date.now();
  try {
    const result = await Promise.race([
      dns.lookup(host),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`dns_timeout_${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    if (!result) return { ok: false, ms: Date.now() - startedAt, error: "dns_no_result" };
    return { ok: true, ms: Date.now() - startedAt, error: null };
  } catch (error) {
    return { ok: false, ms: Date.now() - startedAt, error: formatError(error) };
  }
}

async function probeTcp(host: string, port: number, timeoutMs: number): Promise<ProbeResult> {
  const startedAt = Date.now();
  return await new Promise<ProbeResult>((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean, error: string | null) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({ ok, ms: Date.now() - startedAt, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true, null));
    socket.once("timeout", () => done(false, `tcp_timeout_${timeoutMs}ms`));
    socket.once("error", (err) => done(false, formatError(err)));
  });
}

function jobToSnapshot(
  job:
    | {
        syncType: string;
        status: string;
        startedAt: Date;
        completedAt: Date | null;
        durationMs: number | null;
        errorMessage: string | null;
      }
    | null
): SystemHealthJobSnapshot | null {
  if (!job) return null;
  return {
    syncType: job.syncType,
    status: job.status,
    startedAt: job.startedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    durationMs: job.durationMs,
    errorMessage: job.errorMessage,
  };
}

async function safeQuery<T>(label: string, fallback: T, query: () => Promise<T>): Promise<{ value: T; error: string | null }> {
  try {
    return { value: await query(), error: null };
  } catch (error) {
    const classified = classifyDatabaseError(error);
    if (isRelationMissingError(error)) {
      return { value: fallback, error: `${label}: relation_missing [class=${classified.category}]` };
    }
    return { value: fallback, error: `${label}: ${formatError(error)} [class=${classified.category}]` };
  }
}

export async function getSystemHealthSnapshot(options?: {
  includeExternalProbes?: boolean;
  lightweight?: boolean;
}): Promise<SystemHealthSnapshot> {
  const checkedAt = new Date().toISOString();
  const rawDbUrl = (process.env.DATABASE_URL ?? "").trim();
  const isProduction = process.env.NODE_ENV === "production";
  const dbEnvStatus = getDbEnvStatus({
    requireDirectUrl: (process.env.HEALTH_REQUIRE_DIRECT_URL ?? "").trim() === "1",
  });
  const errors: string[] = [];
  const issues: SystemHealthIssue[] = [];
  const includeExternalProbes = options?.includeExternalProbes === true;
  const lightweight = options?.lightweight === true;
  const runtimeTargets = [
    getDbRuntimeTargetDiagnostics("homepage"),
    getDbRuntimeTargetDiagnostics("health"),
    getDbRuntimeTargetDiagnostics("cron"),
  ];
  const targetIdentity = areRuntimeTargetsIdentical(runtimeTargets);

  let effectiveDbUrl = "";
  let effectiveHost: string | null = null;
  let effectivePort: number | null = null;
  let effectiveParams: Record<string, string> = {};
  try {
    effectiveDbUrl = getEffectiveDatabaseUrl();
    try {
      const url = new URL(effectiveDbUrl);
      effectiveHost = url.hostname || null;
      effectivePort = url.port ? Number(url.port) : 5432;
      effectiveParams = {};
      url.searchParams.forEach((value, key) => {
        effectiveParams[key] = value;
      });
    } catch {
      // ignore parse failure (keep previews only)
    }
  } catch (error) {
    errors.push(`database_url: ${formatError(error)}`);
  }

  // Dış probe'lar pahalı; yalnızca detay modda veya DB ping başarısızsa gerektiğinde çalıştır.
  // Varsayılan health çağrısı hızlı dönmeli.
  let dnsProbe: ProbeResult = { ok: false, ms: null, error: null };
  let tcpProbe: ProbeResult = { ok: false, ms: null, error: null };
  if (includeExternalProbes && effectiveHost && effectivePort) {
    dnsProbe = await probeDns(effectiveHost, 1200);
    tcpProbe = await probeTcp(effectiveHost, effectivePort, 1200);
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const supabaseHost = supabaseUrl
    ? (() => {
        try {
          return new URL(supabaseUrl).hostname;
        } catch {
          return null;
        }
      })()
    : null;
  let supabaseProbe: SystemHealthSnapshot["supabaseRest"] = {
    configured: hasSupabaseRestConfig(),
    host: supabaseHost,
    ok: false,
    status: null,
    latencyMs: null,
    error: null,
    dnsMs: null,
    tcpMs: null,
  };
  if (includeExternalProbes && supabaseHost) {
    const [sDns, sTcp] = await Promise.all([
      probeDns(supabaseHost, 1200),
      probeTcp(supabaseHost, 443, 1200),
    ]);
    supabaseProbe = { ...supabaseProbe, dnsMs: sDns.ms, tcpMs: sTcp.ms };
  }
  if (includeExternalProbes && hasSupabaseRestConfig()) {
    const startedAt = Date.now();
    try {
      await fetchSupabaseRestJson<RestDateRow[]>(
        `FundDailySnapshot?select=date&order=date.desc&limit=1`,
        { revalidate: 0, timeoutMs: 2500, retries: 0 }
      );
      supabaseProbe = { ...supabaseProbe, ok: true, status: 200, latencyMs: Date.now() - startedAt, error: null };
    } catch (error) {
      supabaseProbe = {
        ...supabaseProbe,
        ok: false,
        status: null,
        latencyMs: Date.now() - startedAt,
        error: formatError(error),
      };
    }
  }

  let detailCoreServingReadiness: SystemHealthSnapshot["serving"]["detailCore"] = {
    filePath: ".cache/fund-detail-core-serving.v1.json",
    fileExists: false,
    fileRecordCount: 0,
    fileMissReason: "file_missing",
    dbCacheCount: null,
    dbMissReason: null,
    bootstrap: {
      inFlight: false,
      status: "idle",
      lastStartedAt: null,
      lastCompletedAt: null,
      lastReason: null,
      lastError: null,
    },
  };
  try {
    detailCoreServingReadiness = await getFundDetailCoreServingReadiness({
      includeDbCacheCount: !lightweight,
    });
  } catch (error) {
    errors.push(`detail_core_serving_readiness: ${formatError(error)}`);
  }

  let dbPing: HealthPingResult = {
    ok: false,
    ms: 0,
    source: "query_failed",
    failureCategory: null,
    failureDetail: null,
  };

  try {
    dbPing = await probeDatabaseConnectivity(lightweight);
    if (!dbPing.ok) throw new Error(dbPing.failureDetail ?? "database_ping_failed");
  } catch (error) {
    errors.push(`database_ping: ${formatError(error)}`);
    if (
      shouldRunExternalDbFailureProbes({ includeExternalProbes, lightweight }) &&
      !includeExternalProbes &&
      effectiveHost &&
      effectivePort
    ) {
      dnsProbe = await probeDns(effectiveHost, 1200);
      tcpProbe = await probeTcp(effectiveHost, effectivePort, 1200);
    }
    let latestFundSnapshotDate: Date | null = null;
    let latestMarketSnapshotDate: Date | null = null;
    let latestMacroObservationDate: Date | null = null;
    const restAvailable = hasSupabaseRestConfig();

    // DB ping düşse bile read-path operasyonelliğini anlamak için en azından
    // FundDailySnapshot son tarihini REST üzerinden dene.
    if (restAvailable) {
      try {
        latestFundSnapshotDate = await loadRestLatestDate("FundDailySnapshot");
        if (includeExternalProbes) {
          [latestMarketSnapshotDate, latestMacroObservationDate] = await Promise.all([
            loadRestLatestDate("MarketSnapshot"),
            loadRestLatestDate("MacroObservation"),
          ]);
        }
      } catch (restError) {
        errors.push(`rest_freshness: ${formatError(restError)}`);
      }
    }

    // Prisma ping başarısızsa, external probe'ları da ekle (root cause izolasyonu için).
    if (!includeExternalProbes && hasSupabaseRestConfig() && !lightweight) {
      const startedAt = Date.now();
      try {
        await fetchSupabaseRestJson<RestDateRow[]>(
          `FundDailySnapshot?select=date&order=date.desc&limit=1`,
          { revalidate: 0, timeoutMs: 2500, retries: 0 }
        );
        supabaseProbe = { ...supabaseProbe, ok: true, status: 200, latencyMs: Date.now() - startedAt, error: null };
      } catch (probeError) {
        supabaseProbe = {
          ...supabaseProbe,
          ok: false,
          status: null,
          latencyMs: Date.now() - startedAt,
          error: formatError(probeError),
        };
      }
    }

    const servingReadPathAvailable = Boolean(
      detailCoreServingReadiness.fileRecordCount > 0 || (detailCoreServingReadiness.dbCacheCount ?? 0) > 0
    );
    const readPathOperational = Boolean(
      servingReadPathAvailable || latestFundSnapshotDate || latestMarketSnapshotDate || latestMacroObservationDate
    );
    if (readPathOperational) {
      issues.push({
        code: "database_direct_unavailable_read_path_operational",
        severity: "warning",
        message: "Prisma doğrudan veritabanına bağlanamadı; serving/snapshot read-path fallback aktif.",
      });
    }

    const failureCategory = resolveHealthDbFailureCategory({
      envFailureCategory: dbEnvStatus.failureCategory,
      probeFailureCategory: dbPing.failureCategory,
      classifiedFailureCategory: classifyDatabaseError(error).category,
    });
    const failureDetail = sanitizeFailureDetail(dbPing.failureDetail ?? formatError(error));
    const logPayload = {
      failureCategory,
      failureDetail,
      envStatus: dbEnvStatus,
      pingSource: dbPing.source,
      pingMs: dbPing.ms,
      targetIdentity,
      readPathOperational,
    };
    const healthLogLevel = healthDbPingFailureLogLevel({ readPathOperational, failureCategory });
    if (healthLogLevel === "error") {
      console.error("[health][database_ping_failed]", logPayload);
    } else if (dbPing.source !== "cache_failed") {
      console.info("[health][database_ping_degraded]", logPayload);
    }
    const lightReadPathOperational = lightweight && readPathOperational;
    const returnedErrors = filterExpectedHealthDiagnosticErrors({ errors, readPathOperational });

    return {
      checkedAt,
      ok: lightReadPathOperational,
      status: readPathOperational ? "degraded" : "error",
      database: {
        configured: dbEnvStatus.configured,
        engine:
          effectiveDbUrl.startsWith("postgresql:") || effectiveDbUrl.startsWith("postgres:")
            ? "postgresql"
            : "unknown",
        canConnect: false,
        connectionMode: dbEnvStatus.connectionMode,
        envStatus: dbEnvStatus,
        dbUrlPreview: isProduction ? "(production-hidden)" : redactDatabaseUrl(rawDbUrl).slice(0, 96),
        effectiveDbUrlPreview: isProduction ? "(production-hidden)" : redactDatabaseUrl(effectiveDbUrl).slice(0, 96),
        effectiveHost,
        effectivePort,
        effectiveParams,
        dnsMs: dnsProbe.ms,
        tcpMs: tcpProbe.ms,
        diagnostics: {
          targets: runtimeTargets,
          identicalAcrossPaths: targetIdentity.identical,
          failureCategory,
          failureDetail,
          queryFailureSummary: {},
          pingSource: dbPing.source,
          pingMs: dbPing.ms,
          readPathOperational,
        },
      },
      supabaseRest: supabaseProbe,
      serving: {
        detailCore: detailCoreServingReadiness,
      },
      counts: {
        funds: 0,
        activeFunds: 0,
        categories: 0,
        fundTypes: 0,
        derivedMetrics: 0,
        dailySnapshots: 0,
        marketSnapshots: 0,
        macroSeries: 0,
        macroObservations: 0,
      },
      freshness: {
        latestFundSnapshotDate: latestFundSnapshotDate?.toISOString() ?? null,
        latestMarketSnapshotDate: latestMarketSnapshotDate?.toISOString() ?? null,
        latestMacroObservationDate: latestMacroObservationDate?.toISOString() ?? null,
        latestFundUpdateAt: null,
        latestSnapshotCoverageDate: null,
        lastSuccessfulIngestionAt: null,
        lastPublishedSnapshotAt: null,
        daysSinceLatestFundSnapshot: daysSince(latestFundSnapshotDate),
        daysSinceLatestMarketSnapshot: daysSince(latestMarketSnapshotDate),
        daysSinceLatestMacroObservation: daysSince(latestMacroObservationDate),
      },
      integrity: {
        activeFundsMissingCategory: 0,
        activeFundsMissingFundType: 0,
        activeFundsInvalidLastPrice: 0,
        activeFundsWithoutDailySnapshotOnLatestDate: 0,
        activeFundsWithoutDerivedMetrics: 0,
        latestSnapshotCoverage: null,
        latestSnapshotCoverageGap: null,
        macroSyncStatus: null,
      },
      jobs: {
        sourceRefresh: null,
        servingRebuild: null,
        warmScores: null,
        dailySync: null,
        dailySyncStatus: null,
      },
      issues,
      errors: returnedErrors,
    };
  }

  // DB bağlantısı düşük connection_limit ile çalışırken health endpoint'inin tek çağrıda
  // çok sayıda paralel sorgu ile pool'u kilitlemesini önlemek için sorguları sırayla çalıştırıyoruz.
  if (lightweight) {
    return {
      checkedAt,
      ok: true,
      status: "ok",
      database: {
        configured: dbEnvStatus.configured,
        engine:
          effectiveDbUrl.startsWith("postgresql:") || effectiveDbUrl.startsWith("postgres:")
            ? "postgresql"
            : "unknown",
        canConnect: true,
        connectionMode: dbEnvStatus.connectionMode,
        envStatus: dbEnvStatus,
        dbUrlPreview: isProduction ? "(production-hidden)" : redactDatabaseUrl(rawDbUrl).slice(0, 96),
        effectiveDbUrlPreview: isProduction ? "(production-hidden)" : redactDatabaseUrl(effectiveDbUrl).slice(0, 96),
        effectiveHost,
        effectivePort,
        effectiveParams,
        dnsMs: dnsProbe.ms,
        tcpMs: tcpProbe.ms,
        diagnostics: {
          targets: runtimeTargets,
          identicalAcrossPaths: targetIdentity.identical,
          failureCategory: null,
          failureDetail: null,
          queryFailureSummary: {},
          pingSource: dbPing.source,
          pingMs: dbPing.ms,
          readPathOperational: true,
        },
      },
      supabaseRest: supabaseProbe,
      serving: {
        detailCore: detailCoreServingReadiness,
      },
      counts: {
        funds: 0,
        activeFunds: 0,
        categories: 0,
        fundTypes: 0,
        derivedMetrics: 0,
        dailySnapshots: 0,
        marketSnapshots: 0,
        macroSeries: 0,
        macroObservations: 0,
      },
      freshness: {
        latestFundSnapshotDate: null,
        latestMarketSnapshotDate: null,
        latestMacroObservationDate: null,
        latestFundUpdateAt: null,
        latestSnapshotCoverageDate: null,
        lastSuccessfulIngestionAt: null,
        lastPublishedSnapshotAt: null,
        daysSinceLatestFundSnapshot: null,
        daysSinceLatestMarketSnapshot: null,
        daysSinceLatestMacroObservation: null,
      },
      integrity: {
        activeFundsMissingCategory: 0,
        activeFundsMissingFundType: 0,
        activeFundsInvalidLastPrice: 0,
        activeFundsWithoutDailySnapshotOnLatestDate: 0,
        activeFundsWithoutDerivedMetrics: 0,
        latestSnapshotCoverage: null,
        latestSnapshotCoverageGap: null,
        macroSyncStatus: null,
      },
      jobs: {
        sourceRefresh: null,
        servingRebuild: null,
        warmScores: null,
        dailySync: null,
        dailySyncStatus: null,
      },
      issues,
      errors,
    };
  }

  const fundCountResult = await safeQuery("fund_count", 0, () => prisma.fund.count());
  const activeFundCountResult = await safeQuery("active_fund_count", 0, () =>
    prisma.fund.count({ where: { isActive: true } })
  );
  const categoryCountResult = await safeQuery("category_count", 0, () => prisma.fundCategory.count());
  const fundTypeCountResult = await safeQuery("fund_type_count", 0, () => prisma.fundType.count());
  const derivedMetricsCountResult = await safeQuery("derived_metrics_count", 0, () => prisma.fundDerivedMetrics.count());
  const dailySnapshotCountResult = await safeQuery("daily_snapshot_count", 0, () => prisma.fundDailySnapshot.count());
  const marketSnapshotCountResult = await safeQuery("market_snapshot_count", 0, () => prisma.marketSnapshot.count());
  const macroSeriesCountResult = await safeQuery("macro_series_count", 0, () => prisma.macroSeries.count());
  const macroObservationCountResult = await safeQuery("macro_observation_count", 0, () => prisma.macroObservation.count());
  const activeFundsMissingCategoryResult = await safeQuery("active_funds_missing_category", 0, () =>
    prisma.fund.count({ where: { isActive: true, categoryId: null } })
  );
  const activeFundsMissingFundTypeResult = await safeQuery("active_funds_missing_fund_type", 0, () =>
    prisma.fund.count({ where: { isActive: true, fundTypeId: null } })
  );
  const activeFundsInvalidLastPriceResult = await safeQuery("active_funds_invalid_last_price", 0, () =>
    prisma.fund.count({ where: { isActive: true, lastPrice: { lte: 0 } } })
  );
  const activeFundsWithoutDerivedMetricsResult = await safeQuery("active_funds_without_derived_metrics", 0, () =>
    prisma.fund.count({ where: { isActive: true, derivedMetrics: null } })
  );
  const latestFundSnapshotResult = await safeQuery<{ date: Date; updatedAt: Date } | null>(
    "latest_fund_snapshot",
    null,
    () =>
      prisma.fundDailySnapshot.findFirst({
        orderBy: { date: "desc" },
        select: { date: true, updatedAt: true },
      })
  );
  const latestMarketSnapshotResult = await safeQuery<{ date: Date } | null>("latest_market_snapshot", null, () =>
    prisma.marketSnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    })
  );
  const latestMacroObservationResult = await safeQuery<{ date: Date } | null>("latest_macro_observation", null, () =>
    prisma.macroObservation.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    })
  );
  const latestFundUpdateResult = await safeQuery<{ _max: { lastUpdatedAt: Date | null } }>(
    "latest_fund_update",
    { _max: { lastUpdatedAt: null } },
    () =>
      prisma.fund.aggregate({
        where: { isActive: true },
        _max: { lastUpdatedAt: true },
      })
  );
  const macroSyncStateResult = await safeQuery<{ status: string | null } | null>("macro_sync_state", null, () =>
    prisma.macroSyncState.findUnique({
      where: { key: "macro_series" },
      select: { status: true },
    })
  );
  const latestJobRunsResult = await safeQuery<
    Array<{
      syncType: string;
      status: string;
      startedAt: Date;
      completedAt: Date | null;
      durationMs: number | null;
      errorMessage: string | null;
    }>
  >("latest_job_runs", [], () =>
    prisma.syncLog.findMany({
      where: {
        syncType: {
          in: ["source_refresh", "serving_rebuild", "warm_scores", "daily_sync"],
        },
      },
      orderBy: { startedAt: "desc" },
      take: 24,
      select: {
        syncType: true,
        status: true,
        startedAt: true,
        completedAt: true,
        durationMs: true,
        errorMessage: true,
      },
    })
  );

  const queryErrors = [
    fundCountResult,
    activeFundCountResult,
    categoryCountResult,
    fundTypeCountResult,
    derivedMetricsCountResult,
    dailySnapshotCountResult,
    marketSnapshotCountResult,
    macroSeriesCountResult,
    macroObservationCountResult,
    activeFundsMissingCategoryResult,
    activeFundsMissingFundTypeResult,
    activeFundsInvalidLastPriceResult,
    activeFundsWithoutDerivedMetricsResult,
    latestFundSnapshotResult,
    latestMarketSnapshotResult,
    latestMacroObservationResult,
    latestFundUpdateResult,
    macroSyncStateResult,
    latestJobRunsResult,
  ]
    .map((result) => result.error)
    .filter((value): value is string => Boolean(value));
  errors.push(...queryErrors);
  const queryFailureSummary = queryErrors.reduce<Record<string, number>>((acc, entry) => {
    const marker = entry.match(/\[class=([^\]]+)\]/)?.[1] ?? "unknown";
    acc[marker] = (acc[marker] ?? 0) + 1;
    return acc;
  }, {});

  const latestFundSnapshotDate = latestFundSnapshotResult.value?.date ?? null;
  const latestMarketSnapshotDate = latestMarketSnapshotResult.value?.date ?? null;
  const latestMacroObservationDate = latestMacroObservationResult.value?.date ?? null;
  const latestJobsByType = new Map(
    latestJobRunsResult.value.map((job) => [job.syncType, job] as const)
  );
  const sourceRefreshJob = latestJobsByType.get("source_refresh") ?? null;
  const servingRebuildJob = latestJobsByType.get("serving_rebuild") ?? null;
  const warmScoresJob = latestJobsByType.get("warm_scores") ?? null;
  const dailySyncJob = latestJobsByType.get("daily_sync") ?? null;

  const latestSnapshotCoverageResult = latestFundSnapshotDate
    ? await safeQuery("latest_snapshot_coverage", 0, () =>
        prisma.fundDailySnapshot.count({ where: { date: latestFundSnapshotDate } })
      )
    : { value: 0, error: null as string | null };
  const activeFundsWithoutDailySnapshotResult = latestFundSnapshotDate
    ? await safeQuery("active_funds_without_daily_snapshot", 0, () =>
        prisma.fund.count({
          where: {
            isActive: true,
            dailySnapshots: {
              none: {
                date: latestFundSnapshotDate,
              },
            },
          },
        })
      )
    : { value: 0, error: null as string | null };

  if (latestSnapshotCoverageResult.error) errors.push(latestSnapshotCoverageResult.error);
  if (activeFundsWithoutDailySnapshotResult.error) errors.push(activeFundsWithoutDailySnapshotResult.error);

  const activeFunds = activeFundCountResult.value;
  const latestSnapshotCoverage = latestFundSnapshotDate ? latestSnapshotCoverageResult.value : null;
  const latestSnapshotCoverageGap =
    latestSnapshotCoverage == null ? null : Math.max(0, activeFunds - latestSnapshotCoverage);

  if (activeFunds === 0) {
    issues.push({
      code: "no_active_funds",
      severity: "error",
      message: "Aktif fon bulunamadı.",
    });
  }
  if (!latestFundSnapshotDate) {
    issues.push({
      code: "missing_fund_snapshot",
      severity: "error",
      message: "FundDailySnapshot verisi bulunamadı.",
    });
  }
  if (!latestMarketSnapshotDate) {
    issues.push({
      code: "missing_market_snapshot",
      severity: "warning",
      message: "MarketSnapshot verisi bulunamadı.",
    });
  }
  if (activeFundsMissingCategoryResult.value > 0) {
    issues.push({
      code: "active_funds_missing_category",
      severity: "warning",
      message: `${activeFundsMissingCategoryResult.value} aktif fonda kategori bağlantısı eksik.`,
    });
  }
  if (activeFundsMissingFundTypeResult.value > 0) {
    issues.push({
      code: "active_funds_missing_fund_type",
      severity: "warning",
      message: `${activeFundsMissingFundTypeResult.value} aktif fonda fon türü bağlantısı eksik.`,
    });
  }
  if (activeFundsInvalidLastPriceResult.value > 0) {
    issues.push({
      code: "active_funds_invalid_last_price",
      severity: "warning",
      message: `${activeFundsInvalidLastPriceResult.value} aktif fonda son fiyat 0 veya negatif.`,
    });
  }
  if (activeFundsWithoutDerivedMetricsResult.value > 0) {
    issues.push({
      code: "active_funds_without_derived_metrics",
      severity: "warning",
      message: `${activeFundsWithoutDerivedMetricsResult.value} aktif fonda türetilmiş metrik kaydı yok.`,
    });
  }
  if ((activeFundsWithoutDailySnapshotResult.value ?? 0) > 0) {
    issues.push({
      code: "active_funds_without_daily_snapshot",
      severity: "warning",
      message: `${activeFundsWithoutDailySnapshotResult.value} aktif fon son günlük anlık görüntüye yansımamış.`,
    });
  }
  if ((latestSnapshotCoverageGap ?? 0) > 0) {
    issues.push({
      code: "snapshot_coverage_gap",
      severity: "warning",
      message: `Son anlık görüntü kapsamı aktif fon sayısından ${latestSnapshotCoverageGap} eksik.`,
    });
  }

  const daysSinceLatestFundSnapshot = daysSince(latestFundSnapshotDate);
  const daysSinceLatestMarketSnapshot = daysSince(latestMarketSnapshotDate);
  const daysSinceLatestMacroObservation = daysSince(latestMacroObservationDate);
  const istanbulNow = getIstanbulWallClock();
  const sourceRefreshDateKey = toIstanbulDateKey(sourceRefreshJob?.completedAt ?? null);
  const servingRebuildDateKey = toIstanbulDateKey(servingRebuildJob?.completedAt ?? null);
  const warmScoresDateKey = toIstanbulDateKey(warmScoresJob?.completedAt ?? null);
  const dailySyncDateKey = toIstanbulDateKey(dailySyncJob?.completedAt ?? null);
  const dailySyncMeta = parseDailySyncRunMeta(dailySyncJob?.errorMessage);
  const lastSuccessfulIngestionAt =
    dailySyncJob?.status === "SUCCESS" && dailySyncMeta?.sourceStatus === "success"
      ? dailySyncJob.completedAt?.toISOString() ?? null
      : null;
  const lastPublishedSnapshotAt =
    dailySyncJob?.status === "SUCCESS" && dailySyncMeta?.publishStatus === "success"
      ? dailySyncJob.completedAt?.toISOString() ?? null
      : null;
  const dailySyncStatus: DailySyncStatusView = {
    runKey: dailySyncMeta?.runKey ?? null,
    trigger: dailySyncMeta?.trigger ?? null,
    sourceStatus:
      dailySyncMeta?.sourceStatus === "success" || dailySyncMeta?.sourceStatus === "failed"
        ? dailySyncMeta.sourceStatus
        : "unknown",
    publishStatus:
      dailySyncMeta?.publishStatus === "success" || dailySyncMeta?.publishStatus === "failed"
        ? dailySyncMeta.publishStatus
        : "unknown",
    firstFailedStep: dailySyncMeta?.firstFailedStep ?? null,
    failureKind:
      dailySyncMeta?.failureKind === "none" ||
      dailySyncMeta?.failureKind === "exception" ||
      dailySyncMeta?.failureKind === "timeout_suspected"
        ? dailySyncMeta.failureKind
        : "unknown",
    staleRunRecovered: dailySyncMeta?.staleRunRecovered === true,
    missedSlaToday: false,
  };

  const cronExpectations = [
    {
      key: "source_refresh",
      label: "Source refresh",
      cutoffMinute: DAILY_JOB_SLA_MINUTES.sourceRefresh,
      job: sourceRefreshJob,
      completedDateKey: sourceRefreshDateKey,
    },
    {
      key: "serving_rebuild",
      label: "Serving rebuild",
      cutoffMinute: DAILY_JOB_SLA_MINUTES.servingRebuild,
      job: servingRebuildJob,
      completedDateKey: servingRebuildDateKey,
    },
    {
      key: "warm_scores",
      label: "Scores warm",
      cutoffMinute: DAILY_JOB_SLA_MINUTES.warmScores,
      job: warmScoresJob,
      completedDateKey: warmScoresDateKey,
    },
    {
      key: "daily_sync",
      label: "Daily sync",
      cutoffMinute: DAILY_JOB_SLA_MINUTES.dailySync,
      job: dailySyncJob,
      completedDateKey: dailySyncDateKey,
    },
  ] as const;

  if ((daysSinceLatestFundSnapshot ?? 0) > 1) {
    issues.push({
      code: "stale_fund_snapshot",
      severity: daysSinceLatestFundSnapshot! > 2 ? "error" : "warning",
      message: `FundDailySnapshot verisi ${daysSinceLatestFundSnapshot} gündür güncellenmemiş.`,
    });
  }
  if ((daysSinceLatestMarketSnapshot ?? 0) > 1) {
    issues.push({
      code: "stale_market_snapshot",
      severity: daysSinceLatestMarketSnapshot! > 2 ? "error" : "warning",
      message: `MarketSnapshot verisi ${daysSinceLatestMarketSnapshot} gündür güncellenmemiş.`,
    });
  }
  if ((daysSinceLatestMacroObservation ?? 0) > 45) {
    issues.push({
      code: "stale_macro_observation",
      severity: "warning",
      message: `Makro seri gözlemleri ${daysSinceLatestMacroObservation} gündür güncellenmemiş.`,
    });
  }

  if (isProduction) {
    for (const expectation of cronExpectations) {
      if (istanbulNow.minutesOfDay < expectation.cutoffMinute) continue;
      if (expectation.completedDateKey === istanbulNow.dateKey && expectation.job?.status === "SUCCESS") continue;

      issues.push({
        code: `${expectation.key}_missed_sla`,
        severity: "error",
        message: `${expectation.label} bugün beklenen saatte tamamlanmadı.`,
      });
    }
  }
  dailySyncStatus.missedSlaToday = issues.some((issue) => issue.code === "daily_sync_missed_sla");

  for (const job of [sourceRefreshJob, servingRebuildJob, warmScoresJob, dailySyncJob]) {
    if (!job) continue;
    if ((job.status === "FAILED" || job.status === "TIMEOUT") && toIstanbulDateKey(job.startedAt) === istanbulNow.dateKey) {
      issues.push({
        code: `${job.syncType.toLowerCase()}_${job.status.toLowerCase()}`,
        severity: "error",
        message: `${job.syncType} son koşuda ${job.status.toLowerCase()} oldu${job.errorMessage ? `: ${job.errorMessage}` : "."}`,
      });
    }
    if (!job.completedAt) {
      const runningMinutes = Math.max(0, Math.round((Date.now() - job.startedAt.getTime()) / 60_000));
      if (runningMinutes > 45) {
        issues.push({
          code: `${job.syncType.toLowerCase()}_running_too_long`,
          severity: "warning",
          message: `${job.syncType} ${runningMinutes} dakikadır tamamlanmadı.`,
        });
      }
    }
  }

  if (dailySyncJob?.status === "SUCCESS" && dailySyncMeta?.phase === "daily_sync") {
    if (dailySyncMeta.sourceStatus !== "success") {
      issues.push({
        code: "daily_sync_source_not_success",
        severity: "error",
        message: "Daily sync tamamlandı görünse de source aşaması başarılı değil.",
      });
    }
    if (dailySyncMeta.publishStatus !== "success") {
      issues.push({
        code: "daily_sync_publish_not_success",
        severity: "error",
        message: "Daily sync tamamlandı görünse de publish aşaması başarılı değil.",
      });
    }
  }

  if (!detailCoreServingReadiness.fileExists) {
    issues.push({
      code: "detail_core_serving_file_missing",
      severity: "warning",
      message: "Fund detail core serving dosyası bulunamadı (file_missing).",
    });
  } else if (detailCoreServingReadiness.fileRecordCount === 0) {
    issues.push({
      code: "detail_core_serving_file_empty",
      severity: "warning",
      message: "Fund detail core serving dosyası boş görünüyor (cache_empty).",
    });
  }
  if (detailCoreServingReadiness.dbCacheCount === 0) {
    issues.push({
      code: "detail_core_serving_cache_empty",
      severity: "warning",
      message: "ScoresApiCache içinde fund_detail_core:v1 kayıtları boş.",
    });
  }
  if (detailCoreServingReadiness.bootstrap.status === "failed") {
    issues.push({
      code: "detail_core_serving_bootstrap_failed",
      severity: "warning",
      message: `Detail core bootstrap başarısız: ${detailCoreServingReadiness.bootstrap.lastError ?? "unknown"}`,
    });
  }

  const hasErrorIssue = issues.some((issue) => issue.severity === "error");
  const status: SystemHealthStatus = hasErrorIssue || errors.some((item) => item.startsWith("database_ping"))
    ? "error"
    : errors.length > 0 || issues.length > 0
      ? "degraded"
      : "ok";

  return {
    checkedAt,
    ok: status === "ok",
    status,
    database: {
      configured: dbEnvStatus.configured,
      engine:
        effectiveDbUrl.startsWith("postgresql:") || effectiveDbUrl.startsWith("postgres:")
          ? "postgresql"
          : "unknown",
      canConnect: true,
      connectionMode: dbEnvStatus.connectionMode,
      envStatus: dbEnvStatus,
      dbUrlPreview: isProduction ? "(production-hidden)" : redactDatabaseUrl(rawDbUrl).slice(0, 96),
      effectiveDbUrlPreview: isProduction ? "(production-hidden)" : redactDatabaseUrl(effectiveDbUrl).slice(0, 96),
      effectiveHost,
      effectivePort,
      effectiveParams,
      dnsMs: dnsProbe.ms,
      tcpMs: tcpProbe.ms,
      diagnostics: {
        targets: runtimeTargets,
        identicalAcrossPaths: targetIdentity.identical,
        failureCategory: null,
        failureDetail: null,
        queryFailureSummary,
        pingSource: dbPing.source,
        pingMs: dbPing.ms,
        readPathOperational: true,
      },
    },
    supabaseRest: supabaseProbe,
    serving: {
      detailCore: detailCoreServingReadiness,
    },
    counts: {
      funds: fundCountResult.value,
      activeFunds,
      categories: categoryCountResult.value,
      fundTypes: fundTypeCountResult.value,
      derivedMetrics: derivedMetricsCountResult.value,
      dailySnapshots: dailySnapshotCountResult.value,
      marketSnapshots: marketSnapshotCountResult.value,
      macroSeries: macroSeriesCountResult.value,
      macroObservations: macroObservationCountResult.value,
    },
    freshness: {
      latestFundSnapshotDate: latestFundSnapshotDate?.toISOString() ?? null,
      latestMarketSnapshotDate: latestMarketSnapshotDate?.toISOString() ?? null,
      latestMacroObservationDate: latestMacroObservationDate?.toISOString() ?? null,
      latestFundUpdateAt:
        latestFundSnapshotResult.value?.updatedAt?.toISOString() ??
        latestFundUpdateResult.value._max.lastUpdatedAt?.toISOString() ??
        null,
      latestSnapshotCoverageDate: latestFundSnapshotDate?.toISOString() ?? null,
      lastSuccessfulIngestionAt,
      lastPublishedSnapshotAt,
      daysSinceLatestFundSnapshot,
      daysSinceLatestMarketSnapshot,
      daysSinceLatestMacroObservation,
    },
    integrity: {
      activeFundsMissingCategory: activeFundsMissingCategoryResult.value,
      activeFundsMissingFundType: activeFundsMissingFundTypeResult.value,
      activeFundsInvalidLastPrice: activeFundsInvalidLastPriceResult.value,
      activeFundsWithoutDailySnapshotOnLatestDate: activeFundsWithoutDailySnapshotResult.value,
      activeFundsWithoutDerivedMetrics: activeFundsWithoutDerivedMetricsResult.value,
      latestSnapshotCoverage,
      latestSnapshotCoverageGap,
      macroSyncStatus: macroSyncStateResult.value?.status ?? null,
    },
    jobs: {
      sourceRefresh: jobToSnapshot(sourceRefreshJob),
      servingRebuild: jobToSnapshot(servingRebuildJob),
      warmScores: jobToSnapshot(warmScoresJob),
      dailySync: jobToSnapshot(dailySyncJob),
      dailySyncStatus,
    },
    issues,
    errors,
  };
}

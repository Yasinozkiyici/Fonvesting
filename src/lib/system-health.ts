import { Prisma } from "@prisma/client";
import dns from "node:dns/promises";
import net from "node:net";
import { DAILY_JOB_SLA_MINUTES, getIstanbulWallClock, toIstanbulDateKey } from "@/lib/daily-sync-policy";
import { getEffectiveDatabaseUrl, prisma } from "@/lib/prisma";
import { fetchSupabaseRestJson, hasSupabaseRestConfig } from "@/lib/supabase-rest";

export type SystemHealthStatus = "ok" | "degraded" | "error";
export type SystemHealthIssueSeverity = "warning" | "error";

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
    dbUrlPreview: string;
    effectiveDbUrlPreview: string;
    effectiveHost: string | null;
    effectivePort: number | null;
    effectiveParams: Record<string, string>;
    dnsMs: number | null;
    tcpMs: number | null;
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

function isRelationMissingError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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
    if (isRelationMissingError(error)) {
      return { value: fallback, error: `${label}: relation_missing` };
    }
    return { value: fallback, error: `${label}: ${formatError(error)}` };
  }
}

export async function getSystemHealthSnapshot(options?: { includeExternalProbes?: boolean }): Promise<SystemHealthSnapshot> {
  const checkedAt = new Date().toISOString();
  const rawDbUrl = (process.env.DATABASE_URL ?? "").trim();
  const isProduction = process.env.NODE_ENV === "production";
  const errors: string[] = [];
  const issues: SystemHealthIssue[] = [];
  const includeExternalProbes = options?.includeExternalProbes === true;

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

  // Health endpoint spam'ini azalt: kısa süre içinde aynı process'te tekrar ping atma.
  const globalForHealth = global as unknown as {
    __healthPing?: { at: number; ok: boolean };
  };
  const cachedPing = globalForHealth.__healthPing;

  try {
    if (cachedPing && Date.now() - cachedPing.at < 20_000) {
      if (!cachedPing.ok) throw new Error("database_ping_cached_failed");
    } else {
      // Prisma sorgularını Promise.race ile "timeout" etmek iptal etmediği için
      // serverless ortamda açık handle bırakarak health endpoint'ini kilitleyebilir.
      // Burada URL parametreleri (`connect_timeout`, `pool_timeout`) ile fail-fast davranışa güveniyoruz.
      await prisma.$queryRaw`SELECT 1`;
      globalForHealth.__healthPing = { at: Date.now(), ok: true };
    }
  } catch (error) {
    globalForHealth.__healthPing = { at: Date.now(), ok: false };
    errors.push(`database_ping: ${formatError(error)}`);
    if (!includeExternalProbes && effectiveHost && effectivePort) {
      dnsProbe = await probeDns(effectiveHost, 1200);
      tcpProbe = await probeTcp(effectiveHost, effectivePort, 1200);
    }
    let latestFundSnapshotDate: Date | null = null;
    let latestMarketSnapshotDate: Date | null = null;
    let latestMacroObservationDate: Date | null = null;
    const restAvailable = hasSupabaseRestConfig();

    // Fallback freshness yalnızca detay modda anlamlı; normal health çağrısı hızlı kalmalı.
    if (includeExternalProbes && restAvailable) {
      try {
        [latestFundSnapshotDate, latestMarketSnapshotDate, latestMacroObservationDate] = await Promise.all([
          loadRestLatestDate("FundDailySnapshot"),
          loadRestLatestDate("MarketSnapshot"),
          loadRestLatestDate("MacroObservation"),
        ]);
      } catch (restError) {
        errors.push(`rest_freshness: ${formatError(restError)}`);
      }
    }

    // Prisma ping başarısızsa, external probe'ları da ekle (root cause izolasyonu için).
    if (!includeExternalProbes && hasSupabaseRestConfig()) {
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

    const readPathOperational = Boolean(
      latestFundSnapshotDate || latestMarketSnapshotDate || latestMacroObservationDate
    );
    if (readPathOperational) {
      issues.push({
        code: "database_direct_unavailable",
        severity: "warning",
        message: "Prisma doğrudan veritabanına bağlanamadı; health yanıtı REST freshness fallback ile üretildi.",
      });
    }

    return {
      checkedAt,
      ok: false,
      status: readPathOperational ? "degraded" : "error",
      database: {
        configured: Boolean(rawDbUrl || process.env.NODE_ENV === "development"),
        engine:
          effectiveDbUrl.startsWith("postgresql:") || effectiveDbUrl.startsWith("postgres:")
            ? "postgresql"
            : "unknown",
        canConnect: false,
        dbUrlPreview: isProduction ? "(production-hidden)" : redactDatabaseUrl(rawDbUrl).slice(0, 96),
        effectiveDbUrlPreview: isProduction ? "(production-hidden)" : redactDatabaseUrl(effectiveDbUrl).slice(0, 96),
        effectiveHost,
        effectivePort,
        effectiveParams,
        dnsMs: dnsProbe.ms,
        tcpMs: tcpProbe.ms,
      },
      supabaseRest: supabaseProbe,
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
      },
      issues,
      errors,
    };
  }

  // DB bağlantısı düşük connection_limit ile çalışırken health endpoint'inin tek çağrıda
  // çok sayıda paralel sorgu ile pool'u kilitlemesini önlemek için sorguları sırayla çalıştırıyoruz.
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

  for (const expectation of cronExpectations) {
    if (istanbulNow.minutesOfDay < expectation.cutoffMinute) continue;
    if (expectation.completedDateKey === istanbulNow.dateKey && expectation.job?.status === "SUCCESS") continue;

    issues.push({
      code: `${expectation.key}_missed_sla`,
      severity: "error",
      message: `${expectation.label} bugün beklenen saatte tamamlanmadı.`,
    });
  }

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
      configured: Boolean(rawDbUrl || process.env.NODE_ENV === "development"),
      engine:
        effectiveDbUrl.startsWith("postgresql:") || effectiveDbUrl.startsWith("postgres:")
          ? "postgresql"
          : "unknown",
      canConnect: true,
      dbUrlPreview: isProduction ? "(production-hidden)" : redactDatabaseUrl(rawDbUrl).slice(0, 96),
      effectiveDbUrlPreview: isProduction ? "(production-hidden)" : redactDatabaseUrl(effectiveDbUrl).slice(0, 96),
      effectiveHost,
      effectivePort,
      effectiveParams,
      dnsMs: dnsProbe.ms,
      tcpMs: tcpProbe.ms,
    },
    supabaseRest: supabaseProbe,
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
    },
    issues,
    errors,
  };
}

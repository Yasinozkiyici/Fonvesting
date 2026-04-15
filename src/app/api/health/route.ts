import { NextResponse } from "next/server";
import { getBuildFingerprint } from "@/lib/build-fingerprint";
import { getSystemHealthSnapshot } from "@/lib/system-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = ["fra1"];
const HEALTH_LIGHT_CACHE_TTL_MS = Number(process.env.HEALTH_LIGHT_CACHE_TTL_MS ?? "12000");

type HealthRouteState = {
  lightCache?: {
    at: number;
    snapshot: Awaited<ReturnType<typeof getSystemHealthSnapshot>>;
  };
  lightInFlight?: Promise<Awaited<ReturnType<typeof getSystemHealthSnapshot>>>;
};

function getHealthRouteState(): HealthRouteState {
  const g = global as unknown as { __healthRouteState?: HealthRouteState };
  if (!g.__healthRouteState) g.__healthRouteState = {};
  return g.__healthRouteState;
}

function hasDetailedHealthAccess(headers: Headers): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const configuredSecret = process.env.HEALTH_SECRET?.trim();
  const providedHealthSecret = headers.get("x-health-secret")?.trim();
  if (configuredSecret && providedHealthSecret && providedHealthSecret === configuredSecret) {
    return true;
  }

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;
  const authHeader = headers.get("authorization")?.trim() ?? "";
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  const buildFingerprint = getBuildFingerprint();
  const isProduction = process.env.NODE_ENV === "production";
  const allowDetails = hasDetailedHealthAccess(request.headers);
  const requestUrl = new URL(request.url);
  const requestedMode = (requestUrl.searchParams.get("mode") ?? "").trim().toLowerCase();
  const forceLightMode = requestedMode === "light";
  const forceFullMode = requestedMode === "full";
  const fullDetails =
    allowDetails &&
    (forceFullMode || (!forceLightMode && requestUrl.searchParams.get("full") === "1"));
  const includeExternalProbes = fullDetails && requestUrl.searchParams.get("probes") === "1";
  const healthMode = fullDetails ? "full" : "light";
  let snapshot: Awaited<ReturnType<typeof getSystemHealthSnapshot>>;
  if (!fullDetails) {
    const state = getHealthRouteState();
    const cached = state.lightCache;
    if (cached && Date.now() - cached.at <= Math.max(2_000, HEALTH_LIGHT_CACHE_TTL_MS)) {
      snapshot = cached.snapshot;
    } else if (state.lightInFlight) {
      snapshot = await state.lightInFlight;
    } else {
      const task = getSystemHealthSnapshot({
        includeExternalProbes: false,
        lightweight: true,
      });
      state.lightInFlight = task;
      try {
        snapshot = await task;
        state.lightCache = { at: Date.now(), snapshot };
      } finally {
        state.lightInFlight = undefined;
      }
    }
  } else {
    snapshot = await getSystemHealthSnapshot({
      includeExternalProbes,
      lightweight: false,
    });
  }
  const strictMode = fullDetails || requestUrl.searchParams.get("strict") === "1";
  /**
   * Launch-safety: light health çağrısı fail-soft döner (200 + degraded payload).
   * Strict/full modda liveness için DB erişimi zorunlu (başarısızsa 503).
   */
  const statusCode = snapshot.database.canConnect || !strictMode ? 200 : 503;
  const dbProbeUsed = snapshot.database.diagnostics.pingSource;
  const systemCheckDegraded = snapshot.status !== "ok" || snapshot.issues.length > 0 || snapshot.errors.length > 0;
  const systemCheckReason =
    snapshot.database.diagnostics.failureCategory ??
    snapshot.issues[0]?.code ??
    snapshot.errors[0] ??
    "none";
  console.info(
    `[health-route] health_mode=${healthMode} full=${fullDetails ? 1 : 0} probes=${includeExternalProbes ? 1 : 0} ` +
      `health_db_probe_used=${dbProbeUsed} health_db_probe_ms=${snapshot.database.diagnostics.pingMs ?? -1} ` +
      `system_check_degraded=${systemCheckDegraded ? 1 : 0} system_check_reason=${systemCheckReason} strict=${strictMode ? 1 : 0} status=${statusCode}`
  );
  const sharedHeaders: Record<string, string> = {
    "X-Health-Mode": healthMode,
    "X-Health-Strict": strictMode ? "1" : "0",
    "X-Health-Db-Probe-Used": dbProbeUsed,
    "X-Health-Db-Probe-Ms": String(snapshot.database.diagnostics.pingMs ?? -1),
    "X-Health-Read-Path-Operational": snapshot.database.diagnostics.readPathOperational ? "1" : "0",
    "X-System-Check-Degraded": systemCheckDegraded ? "1" : "0",
    "X-System-Check-Reason": systemCheckReason,
    "X-Db-Env-Status": snapshot.database.envStatus.failureCategory ?? "ok",
    "X-Db-Connection-Mode": snapshot.database.connectionMode,
    "X-Db-Failure-Class": snapshot.database.diagnostics.failureCategory ?? "none",
    "X-Daily-Sync-Source-Status": snapshot.jobs.dailySyncStatus?.sourceStatus ?? "unknown",
    "X-Daily-Sync-Publish-Status": snapshot.jobs.dailySyncStatus?.publishStatus ?? "unknown",
    "X-Daily-Sync-Missed-Sla": snapshot.jobs.dailySyncStatus?.missedSlaToday ? "1" : "0",
    "X-Daily-Sync-Run-Key": snapshot.jobs.dailySyncStatus?.runKey ?? "none",
    "X-Build-Commit": buildFingerprint.commitShort ?? "unknown",
    "X-Build-Env": buildFingerprint.env ?? "unknown",
  };

  if (isProduction && !allowDetails) {
    return NextResponse.json(
      {
        ok: snapshot.ok,
        status: snapshot.status,
        service: "fonvesting",
        timestamp: snapshot.checkedAt,
        liveness: snapshot.database.canConnect,
        livenessDetail: snapshot.database.canConnect
          ? null
          : snapshot.database.diagnostics.failureCategory ?? "database_unreachable",
        database: {
          configured: snapshot.database.configured,
          engine: snapshot.database.engine,
          canConnect: snapshot.database.canConnect,
          connectionMode: snapshot.database.connectionMode,
          failureCategory: snapshot.database.diagnostics.failureCategory,
          failureDetail: snapshot.database.diagnostics.failureDetail,
          envStatus: snapshot.database.envStatus,
          diagnostics: {
            identicalAcrossPaths: snapshot.database.diagnostics.identicalAcrossPaths,
            failureCategory: snapshot.database.diagnostics.failureCategory,
          },
        },
        serving: {
          detailCore: {
            fileExists: snapshot.serving.detailCore.fileExists,
            fileRecordCount: snapshot.serving.detailCore.fileRecordCount,
            fileMissReason: snapshot.serving.detailCore.fileMissReason,
            dbCacheCount: snapshot.serving.detailCore.dbCacheCount,
            dbMissReason: snapshot.serving.detailCore.dbMissReason,
            bootstrapStatus: snapshot.serving.detailCore.bootstrap.status,
          },
        },
        counts: {
          funds: snapshot.counts.funds,
          activeFunds: snapshot.counts.activeFunds,
        },
        freshness: {
          latestFundSnapshotDate: snapshot.freshness.latestFundSnapshotDate,
          latestMarketSnapshotDate: snapshot.freshness.latestMarketSnapshotDate,
          latestMacroObservationDate: snapshot.freshness.latestMacroObservationDate,
          lastSuccessfulIngestionAt: snapshot.freshness.lastSuccessfulIngestionAt,
          lastPublishedSnapshotAt: snapshot.freshness.lastPublishedSnapshotAt,
        },
        integrity: {
          macroSyncStatus: snapshot.integrity.macroSyncStatus,
          latestSnapshotCoverageGap: snapshot.integrity.latestSnapshotCoverageGap,
        },
        jobs: snapshot.jobs,
        dailySync: {
          sourceStatus: snapshot.jobs.dailySyncStatus?.sourceStatus ?? "unknown",
          publishStatus: snapshot.jobs.dailySyncStatus?.publishStatus ?? "unknown",
          missedSlaToday: snapshot.jobs.dailySyncStatus?.missedSlaToday ?? false,
          runKey: snapshot.jobs.dailySyncStatus?.runKey ?? null,
          failureKind: snapshot.jobs.dailySyncStatus?.failureKind ?? "unknown",
          firstFailedStep: snapshot.jobs.dailySyncStatus?.firstFailedStep ?? null,
        },
        issueCount: snapshot.issues.length,
        build: {
          commit: buildFingerprint.commitShort,
          deployment: buildFingerprint.deploymentId,
          env: buildFingerprint.env,
          generatedAt: buildFingerprint.generatedAt,
        },
      },
      { status: statusCode, headers: sharedHeaders }
    );
  }

  return NextResponse.json(
    {
      ...snapshot,
      service: "fonvesting",
      timestamp: snapshot.checkedAt,
      build: {
        commit: buildFingerprint.commitShort,
        deployment: buildFingerprint.deploymentId,
        env: buildFingerprint.env,
        generatedAt: buildFingerprint.generatedAt,
      },
      hint: "Yerel: docker compose up -d ve .env/.env.local içinde PostgreSQL DATABASE_URL. Üretim: pnpm exec prisma migrate deploy.",
    },
    { status: statusCode, headers: sharedHeaders }
  );
}

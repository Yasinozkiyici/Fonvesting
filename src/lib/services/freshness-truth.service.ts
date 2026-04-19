import { prisma } from "@/lib/prisma";
import { getIstanbulWallClock, toIstanbulDateKey } from "@/lib/daily-sync-policy";
import { deriveFreshnessContract } from "@/lib/freshness-contract";
import { parseDailySyncRunMeta } from "@/lib/daily-sync-run-meta";

export type FreshnessDegradedReason =
  | "none"
  | "source_unavailable"
  | "sync_meta_malformed"
  | "daily_sync_not_completed_today"
  | "snapshot_lagging"
  | "serving_lagging_raw";

export type FreshnessTruth = {
  snapshotAsOf: string | null;
  rawSnapshotAsOf: string | null;
  servingSnapshotAsOf: string | null;
  latestSuccessfulSyncAt: string | null;
  staleByHours: number | null;
  staleByDays: number | null;
  freshnessStatus: "fresh" | "stale_ok" | "degraded_outdated";
  degradedReason: FreshnessDegradedReason;
  sourceUnavailable: boolean;
  servingLagDays: number | null;
  rawLagDays: number | null;
  dailySyncCompletedToday: boolean;
  staleButServing: boolean;
};

export function evaluateFreshnessTruth(input: {
  nowMs: number;
  expectedDateKey: string;
  snapshotAsOf: string | null;
  rawSnapshotAsOf: string | null;
  servingSnapshotAsOf: string | null;
  latestSuccessfulSyncAt: string | null;
  lastDailySyncCompletedDateKey: string | null;
  sourceUnavailable: boolean;
  syncMetaMalformed: boolean;
}): FreshnessTruth {
  const base = deriveFreshnessContract({
    asOf: input.snapshotAsOf,
    freshTtlMs: 6 * 60 * 60_000,
    staleTtlMs: 36 * 60 * 60_000,
    nowMs: input.nowMs,
    unknownAsDegraded: true,
  });
  const staleByHours = base.ageMs != null ? base.ageMs / 3_600_000 : null;
  const staleByDays = staleByHours != null ? staleByHours / 24 : null;
  const toDaysLag = (latestIso: string | null): number | null => {
    if (!latestIso) return null;
    const ms = Date.parse(latestIso);
    if (!Number.isFinite(ms)) return null;
    return Math.max(0, Math.floor((input.nowMs - ms) / 86_400_000));
  };
  const rawLagDays = toDaysLag(input.rawSnapshotAsOf);
  const servingLagDays =
    input.rawSnapshotAsOf && input.servingSnapshotAsOf
      ? Math.max(
          0,
          Math.floor(
            (Date.parse(input.rawSnapshotAsOf) - Date.parse(input.servingSnapshotAsOf)) /
              86_400_000
          )
        )
      : null;
  const dailySyncCompletedToday =
    input.lastDailySyncCompletedDateKey != null &&
    input.lastDailySyncCompletedDateKey === input.expectedDateKey;
  const staleButServing =
    (base.state === "stale_ok" || base.state === "degraded_outdated") &&
    !input.sourceUnavailable;

  let degradedReason: FreshnessDegradedReason = "none";
  if (input.sourceUnavailable) degradedReason = "source_unavailable";
  else if (input.syncMetaMalformed) degradedReason = "sync_meta_malformed";
  else if (!dailySyncCompletedToday) degradedReason = "daily_sync_not_completed_today";
  else if ((rawLagDays ?? 0) > 1) degradedReason = "snapshot_lagging";
  else if ((servingLagDays ?? 0) > 0) degradedReason = "serving_lagging_raw";
  else if (base.state === "degraded_outdated") degradedReason = "snapshot_lagging";

  return {
    snapshotAsOf: input.snapshotAsOf,
    rawSnapshotAsOf: input.rawSnapshotAsOf,
    servingSnapshotAsOf: input.servingSnapshotAsOf,
    latestSuccessfulSyncAt: input.latestSuccessfulSyncAt,
    staleByHours,
    staleByDays,
    freshnessStatus: base.state,
    degradedReason,
    sourceUnavailable: input.sourceUnavailable,
    servingLagDays,
    rawLagDays,
    dailySyncCompletedToday,
    staleButServing,
  };
}

type FreshnessTruthState = {
  value: FreshnessTruth | null;
  at: number;
  inflight: Promise<FreshnessTruth> | null;
};

function getState(): FreshnessTruthState {
  const g = globalThis as typeof globalThis & { __freshnessTruthState?: FreshnessTruthState };
  if (!g.__freshnessTruthState) {
    g.__freshnessTruthState = { value: null, at: 0, inflight: null };
  }
  return g.__freshnessTruthState;
}

export async function readFreshnessTruthCached(): Promise<FreshnessTruth> {
  const state = getState();
  const now = Date.now();
  if (state.value && now - state.at < 15_000) return state.value;
  if (state.inflight) return state.inflight;
  const task = (async (): Promise<FreshnessTruth> => {
    const ist = getIstanbulWallClock();
    try {
      const [latestSnapshot, latestRawSnapshot, latestServing, latestDailySync] = await Promise.all([
        prisma.fundDailySnapshot.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
        prisma.rawPricesPayload.findFirst({ orderBy: { effectiveDate: "desc" }, select: { effectiveDate: true } }),
        prisma.servingFundList.findFirst({ orderBy: { snapshotAsOf: "desc" }, select: { snapshotAsOf: true } }),
        prisma.syncLog.findFirst({
          where: { syncType: "daily_sync" },
          orderBy: { startedAt: "desc" },
          select: { status: true, completedAt: true, errorMessage: true },
        }),
      ]);
      const meta = parseDailySyncRunMeta(latestDailySync?.errorMessage);
      const syncMetaMalformed = Boolean(
        latestDailySync &&
          typeof latestDailySync.errorMessage === "string" &&
          latestDailySync.errorMessage.trim().startsWith("{") &&
          !meta
      );
      const latestSuccessfulSyncAt =
        latestDailySync?.status === "SUCCESS" && meta?.sourceStatus === "success"
          ? latestDailySync.completedAt?.toISOString() ?? null
          : null;
      const dailySyncCompletedDateKey = toIstanbulDateKey(latestDailySync?.completedAt ?? null);
      return evaluateFreshnessTruth({
        nowMs: now,
        expectedDateKey: ist.dateKey,
        snapshotAsOf: latestSnapshot?.date?.toISOString() ?? null,
        rawSnapshotAsOf: latestRawSnapshot?.effectiveDate?.toISOString() ?? null,
        servingSnapshotAsOf: latestServing?.snapshotAsOf?.toISOString() ?? null,
        latestSuccessfulSyncAt,
        lastDailySyncCompletedDateKey: dailySyncCompletedDateKey,
        sourceUnavailable: false,
        syncMetaMalformed,
      });
    } catch {
      return evaluateFreshnessTruth({
        nowMs: now,
        expectedDateKey: ist.dateKey,
        snapshotAsOf: null,
        rawSnapshotAsOf: null,
        servingSnapshotAsOf: null,
        latestSuccessfulSyncAt: null,
        lastDailySyncCompletedDateKey: null,
        sourceUnavailable: true,
        syncMetaMalformed: false,
      });
    }
  })();
  state.inflight = task;
  try {
    const value = await task;
    state.value = value;
    state.at = Date.now();
    return value;
  } finally {
    state.inflight = null;
  }
}


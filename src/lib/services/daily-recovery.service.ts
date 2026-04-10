import { prisma } from "@/lib/prisma";
import { latestExpectedBusinessSessionDate } from "@/lib/daily-sync-policy";
import { sendOpsAlert } from "@/lib/ops-alerts";
import { runLoggedJob } from "@/lib/job-runs";
import { runDailySourceRefresh } from "@/lib/services/daily-source-refresh.service";
import { runServingRebuild } from "@/lib/services/serving-rebuild.service";
import { warmAllScoresApiCaches } from "@/lib/services/fund-scores-cache.service";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";

type RecoveryPhaseStatus = "executed" | "already_running" | "skipped";

export type DailyRecoveryPhase = {
  status: RecoveryPhaseStatus;
  reason: string;
  details?: unknown;
};

export type DailyRecoveryResult = {
  ok: boolean;
  expectedSessionDate: string;
  before: RecoveryState;
  after: RecoveryState;
  phases: {
    sourceRefresh: DailyRecoveryPhase;
    servingRebuild: DailyRecoveryPhase;
    warmScores: DailyRecoveryPhase;
  };
};

type RecoveryState = {
  latestHistoryDate: string | null;
  latestSnapshotDate: string | null;
  latestSnapshotUpdatedAt: string | null;
  latestMarketSnapshotDate: string | null;
  latestScoresCacheUpdatedAt: string | null;
  latestMacroObservationDate: string | null;
};

type FreshnessHeads = {
  historyDate: Date | null;
  snapshotDate: Date | null;
  snapshotUpdatedAt: Date | null;
  marketDate: Date | null;
  scoresUpdatedAt: Date | null;
  macroDate: Date | null;
};

function asIso(date: Date | null): string | null {
  return date?.toISOString() ?? null;
}

function normalizeState(heads: FreshnessHeads): RecoveryState {
  return {
    latestHistoryDate: asIso(heads.historyDate),
    latestSnapshotDate: asIso(heads.snapshotDate),
    latestSnapshotUpdatedAt: asIso(heads.snapshotUpdatedAt),
    latestMarketSnapshotDate: asIso(heads.marketDate),
    latestScoresCacheUpdatedAt: asIso(heads.scoresUpdatedAt),
    latestMacroObservationDate: asIso(heads.macroDate),
  };
}

function dayAtLeast(date: Date | null, expected: Date): boolean {
  return Boolean(date && startOfUtcDay(date).getTime() >= expected.getTime());
}

async function readFreshnessHeads(): Promise<FreshnessHeads> {
  const [history, snapshot, market, scores, macro] = await Promise.all([
    prisma.fundPriceHistory.findFirst({
      orderBy: [{ date: "desc" }],
      select: { date: true },
    }),
    prisma.fundDailySnapshot.findFirst({
      orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
      select: { date: true, updatedAt: true },
    }),
    prisma.marketSnapshot.findFirst({
      orderBy: [{ date: "desc" }],
      select: { date: true },
    }),
    prisma.scoresApiCache.findFirst({
      orderBy: [{ updatedAt: "desc" }],
      select: { updatedAt: true },
    }),
    prisma.macroObservation.findFirst({
      orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
      select: { date: true },
    }),
  ]);

  return {
    historyDate: history?.date ?? null,
    snapshotDate: snapshot?.date ?? null,
    snapshotUpdatedAt: snapshot?.updatedAt ?? null,
    marketDate: market?.date ?? null,
    scoresUpdatedAt: scores?.updatedAt ?? null,
    macroDate: macro?.date ?? null,
  };
}

async function maybeRunSourceRefresh(expectedSessionDate: Date): Promise<DailyRecoveryPhase> {
  const heads = await readFreshnessHeads();
  const sourceCovered =
    dayAtLeast(heads.historyDate, expectedSessionDate) &&
    dayAtLeast(heads.macroDate, expectedSessionDate);
  if (sourceCovered) {
    return { status: "skipped", reason: "source_current" };
  }

  const run = await runLoggedJob("source_refresh", () =>
    runDailySourceRefresh({
      overlapDays: 10,
      historyAttempts: 3,
      macroAttempts: 3,
      retryDelayMs: 15_000,
      staleMinutes: 60,
    }), {
      staleMinutes: 60,
      onSuccess: (result) => ({
        fundsUpdated: result.history.writtenRows,
        fundsCreated: result.macro.writtenRows,
        note: `retry_history=${result.attempts.history},retry_macro=${result.attempts.macro}`,
      }),
    }
  );

  if (!run.ok) {
    return { status: "already_running", reason: "source_refresh_running", details: { startedAt: run.startedAt } };
  }

  return { status: "executed", reason: "source_recovered", details: run.result };
}

async function maybeRunServingRebuild(): Promise<DailyRecoveryPhase> {
  const heads = await readFreshnessHeads();
  const latestHistoryDate = heads.historyDate;
  if (!latestHistoryDate) {
    return { status: "skipped", reason: "no_history" };
  }

  const snapshotCurrent = Boolean(
    heads.snapshotDate && startOfUtcDay(heads.snapshotDate).getTime() >= startOfUtcDay(latestHistoryDate).getTime()
  );
  const marketCurrent = Boolean(
    heads.marketDate && startOfUtcDay(heads.marketDate).getTime() >= startOfUtcDay(latestHistoryDate).getTime()
  );

  if (snapshotCurrent && marketCurrent) {
    return { status: "skipped", reason: "serving_current" };
  }

  const run = await runLoggedJob("serving_rebuild", () => runServingRebuild({ warmCaches: false }), {
    staleMinutes: 60,
    onSuccess: (result) => ({
      fundsUpdated: result.serving.written,
      fundsCreated: result.derived.written,
      note: `retry_snapshot=${result.snapshotDate}`,
    }),
  });

  if (!run.ok) {
    return { status: "already_running", reason: "serving_rebuild_running", details: { startedAt: run.startedAt } };
  }

  return { status: "executed", reason: "serving_recovered", details: run.result };
}

async function maybeRunWarmScores(): Promise<DailyRecoveryPhase> {
  const heads = await readFreshnessHeads();
  if (!heads.snapshotUpdatedAt) {
    return { status: "skipped", reason: "no_snapshot" };
  }
  const current = Boolean(heads.scoresUpdatedAt && heads.scoresUpdatedAt.getTime() >= heads.snapshotUpdatedAt.getTime());
  if (current) {
    return { status: "skipped", reason: "scores_current" };
  }

  const run = await runLoggedJob("warm_scores", () => warmAllScoresApiCaches(), {
    staleMinutes: 60,
    onSuccess: (warm) => ({
      fundsUpdated: warm.written,
      note: "retry_scores_cache_warmed",
    }),
  });

  if (!run.ok) {
    return { status: "already_running", reason: "warm_scores_running", details: { startedAt: run.startedAt } };
  }

  return { status: "executed", reason: "scores_recovered", details: run.result };
}

function summarizeRecoveryLines(result: DailyRecoveryResult): string[] {
  return [
    `source=${result.phases.sourceRefresh.status}:${result.phases.sourceRefresh.reason}`,
    `serving=${result.phases.servingRebuild.status}:${result.phases.servingRebuild.reason}`,
    `scores=${result.phases.warmScores.status}:${result.phases.warmScores.reason}`,
    `before_history=${result.before.latestHistoryDate ?? "none"}`,
    `after_snapshot=${result.after.latestSnapshotDate ?? "none"}`,
    `after_market=${result.after.latestMarketSnapshotDate ?? "none"}`,
  ];
}

export async function runDailyRecovery(): Promise<DailyRecoveryResult> {
  const expectedSessionDate = latestExpectedBusinessSessionDate();
  const beforeHeads = await readFreshnessHeads();
  const before = normalizeState(beforeHeads);

  const sourceRefresh = await maybeRunSourceRefresh(expectedSessionDate);
  const servingRebuild = await maybeRunServingRebuild();
  const warmScores = await maybeRunWarmScores();

  const afterHeads = await readFreshnessHeads();
  const after = normalizeState(afterHeads);
  const ok =
    dayAtLeast(afterHeads.historyDate, expectedSessionDate) &&
    dayAtLeast(afterHeads.snapshotDate, expectedSessionDate) &&
    dayAtLeast(afterHeads.marketDate, expectedSessionDate) &&
    dayAtLeast(afterHeads.macroDate, expectedSessionDate) &&
    Boolean(
      afterHeads.snapshotUpdatedAt &&
      afterHeads.scoresUpdatedAt &&
      afterHeads.scoresUpdatedAt.getTime() >= afterHeads.snapshotUpdatedAt.getTime()
    );

  const result: DailyRecoveryResult = {
    ok,
    expectedSessionDate: expectedSessionDate.toISOString(),
    before,
    after,
    phases: {
      sourceRefresh,
      servingRebuild,
      warmScores,
    },
  };

  const touched =
    sourceRefresh.status !== "skipped" ||
    servingRebuild.status !== "skipped" ||
    warmScores.status !== "skipped";

  if (touched || !ok) {
    await sendOpsAlert({
      title: ok ? "daily recovery executed" : "daily recovery still degraded",
      severity: ok ? "warning" : "error",
      lines: summarizeRecoveryLines(result),
    });
  }

  return result;
}

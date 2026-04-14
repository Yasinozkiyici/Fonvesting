import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import { rebuildFundDailySnapshots } from "@/lib/services/fund-daily-snapshot.service";
import { rebuildFundDerivedMetrics } from "@/lib/services/fund-derived-metrics.service";
import { warmAllScoresApiCaches } from "@/lib/services/fund-scores-cache.service";
import { rebuildFundDetailCoreServingCache } from "@/lib/services/fund-detail-core-serving.service";
import { refreshFundHistorySyncState } from "@/lib/services/tefas-history.service";
import { rebuildMarketSnapshot, recomputeFundReturnsFromHistory } from "@/lib/services/tefas-sync.service";
import { fetchUsdTryEurTryLive } from "@/lib/services/exchange-rates.service";
import { classifyDailyReturnPctPoints2dp, countDailyReturnDirections } from "@/lib/daily-return-ui";

type ServingStepTiming = {
  name: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  details?: Record<string, unknown>;
};

export class ServingStepError extends Error {
  stepName: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  details?: Record<string, unknown>;
  causeMessage: string;

  constructor(input: {
    stepName: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    details?: Record<string, unknown>;
    cause: unknown;
  }) {
    const causeMessage = input.cause instanceof Error ? input.cause.message : String(input.cause);
    super(`[serving-step:${input.stepName}] ${causeMessage}`);
    this.name = "ServingStepError";
    this.stepName = input.stepName;
    this.startedAt = input.startedAt;
    this.finishedAt = input.finishedAt;
    this.durationMs = input.durationMs;
    this.details = input.details;
    this.causeMessage = causeMessage;
  }
}

export type ServingRebuildResult = {
  snapshotDate: string;
  fundStats: {
    updatedFunds: number;
  };
  returns: {
    updatedFunds: number;
  };
  serving: {
    written: number;
  };
  derived: {
    written: number;
  };
  warm: {
    written: number;
  };
  detailCore: {
    written: number;
  };
  timings: {
    totalMs: number;
    steps: ServingStepTiming[];
  };
};

export type ServingDailyRefreshResult = ServingRebuildResult & {
  mode: "incremental_daily";
  deferred: {
    derived: boolean;
    warmCaches: boolean;
  };
};

type IncrementalSnapshotResult = {
  written: number;
  scannedFunds: number;
  fundsWithCurrentHistory: number;
  fundsCarriedForward: number;
  carriedFromPreviousRows: number;
  newlyInitializedRows: number;
  previousSnapshotDate: string | null;
  fallbackToFullRebuild: boolean;
};

async function resolveLatestSnapshotDate(): Promise<Date> {
  const latestHistory = await prisma.fundPriceHistory.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return startOfUtcDay(latestHistory?.date ?? new Date());
}

async function syncFundServingStatsFromHistory(snapshotDate: Date): Promise<{ updatedFunds: number }> {
  const updatedFunds = await prisma.$executeRaw(Prisma.sql`
    WITH latest_history AS (
      SELECT DISTINCT ON ("fundId")
        "fundId",
        COALESCE("portfolioSize", 0) AS "portfolioSize",
        COALESCE("investorCount", 0) AS "investorCount"
      FROM "FundPriceHistory"
      WHERE "date" <= ${snapshotDate}
      ORDER BY "fundId", "date" DESC
    )
    UPDATE "Fund" AS fund
    SET
      "portfolioSize" = latest_history."portfolioSize",
      "investorCount" = latest_history."investorCount",
      "lastUpdatedAt" = ${snapshotDate}
    FROM latest_history
    WHERE fund."id" = latest_history."fundId"
  `);

  return { updatedFunds: Number(updatedFunds) };
}

async function rebuildFundDailySnapshotsIncremental(snapshotDate: Date): Promise<IncrementalSnapshotResult> {
  const sessionDate = startOfUtcDay(snapshotDate);
  const retentionCutoff = new Date(sessionDate.getTime() - 1095 * 24 * 60 * 60 * 1000);

  const funds = await prisma.fund.findMany({
    where: { isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      shortName: true,
      logoUrl: true,
      lastPrice: true,
      dailyReturn: true,
      monthlyReturn: true,
      yearlyReturn: true,
      portfolioSize: true,
      investorCount: true,
      category: { select: { code: true, name: true } },
      fundType: { select: { code: true, name: true } },
    },
    orderBy: { code: "asc" },
  });

  const latestPrevious = await prisma.fundDailySnapshot.findFirst({
    where: { date: { lt: sessionDate } },
    orderBy: { date: "desc" },
    select: { date: true },
  });

  if (!latestPrevious) {
    const full = await rebuildFundDailySnapshots(sessionDate);
    return {
      written: full.written,
      scannedFunds: funds.length,
      fundsWithCurrentHistory: 0,
      fundsCarriedForward: 0,
      carriedFromPreviousRows: 0,
      newlyInitializedRows: full.written,
      previousSnapshotDate: null,
      fallbackToFullRebuild: true,
    };
  }

  const previousRows = await prisma.fundDailySnapshot.findMany({
    where: { date: latestPrevious.date },
    select: {
      fundId: true,
      lastPrice: true,
      dailyReturn: true,
      monthlyReturn: true,
      yearlyReturn: true,
      portfolioSize: true,
      investorCount: true,
      riskLevel: true,
      alpha: true,
      sparkline: true,
      scores: true,
      metrics: true,
      finalScoreBest: true,
      finalScoreLowRisk: true,
      finalScoreHighReturn: true,
      finalScoreStable: true,
    },
  });

  const recentHistoryRows = await prisma.fundPriceHistory.findMany({
    where: {
      fundId: { in: funds.map((fund) => fund.id) },
      date: {
        gte: new Date(sessionDate.getTime() - 7 * 24 * 60 * 60 * 1000),
        lte: sessionDate,
      },
    },
    orderBy: [{ fundId: "asc" }, { date: "desc" }],
    select: { fundId: true, date: true, price: true, portfolioSize: true, investorCount: true },
  });

  const previousByFund = new Map(previousRows.map((row) => [row.fundId, row]));
  const historyByFund = new Map<string, Array<{ date: Date; price: number; portfolioSize: number; investorCount: number }>>();
  for (const row of recentHistoryRows) {
    const bucket = historyByFund.get(row.fundId) ?? [];
    bucket.push({
      date: startOfUtcDay(row.date),
      price: row.price,
      portfolioSize: row.portfolioSize,
      investorCount: row.investorCount,
    });
    historyByFund.set(row.fundId, bucket);
  }

  let carriedFromPreviousRows = 0;
  let newlyInitializedRows = 0;
  let fundsWithCurrentHistory = 0;
  let fundsCarriedForward = 0;

  const computeDailyReturn = (previousPrice: number, currentPrice: number): number => {
    if (!Number.isFinite(previousPrice) || !Number.isFinite(currentPrice) || previousPrice <= 0) return 0;
    const value = ((currentPrice - previousPrice) / previousPrice) * 100;
    if (!Number.isFinite(value) || Math.abs(value) > 100) return 0;
    return value;
  };

  const rows = funds.map((fund) => {
    const prev = previousByFund.get(fund.id);
    const history = historyByFund.get(fund.id) ?? [];
    const current = history.find((point) => point.date.getTime() === sessionDate.getTime() && point.price > 0);
    const previousSession = history.find((point) => point.date.getTime() < sessionDate.getTime() && point.price > 0);

    if (current) fundsWithCurrentHistory += 1;
    else fundsCarriedForward += 1;

    if (prev) carriedFromPreviousRows += 1;
    else newlyInitializedRows += 1;

    const lastPrice = current?.price ?? prev?.lastPrice ?? fund.lastPrice;
    const dailyReturn = current
      ? computeDailyReturn(previousSession?.price ?? prev?.lastPrice ?? 0, current.price)
      : (prev?.dailyReturn ?? fund.dailyReturn);
    const portfolioSize = Number.isFinite(current?.portfolioSize)
      ? Number(current?.portfolioSize)
      : (prev?.portfolioSize ?? fund.portfolioSize);
    const investorCount = Number.isFinite(current?.investorCount)
      ? Number(current?.investorCount)
      : (prev?.investorCount ?? fund.investorCount);

    const sparkline = Array.isArray(prev?.sparkline)
      ? (prev?.sparkline as unknown[]).filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      : [lastPrice];

    return {
      date: sessionDate,
      fundId: fund.id,
      code: fund.code,
      name: fund.name,
      shortName: fund.shortName,
      logoUrl: fund.logoUrl,
      categoryCode: fund.category?.code ?? null,
      categoryName: fund.category?.name ?? null,
      fundTypeCode: fund.fundType?.code ?? null,
      fundTypeName: fund.fundType?.name ?? null,
      riskLevel: prev?.riskLevel ?? "BILINMIYOR",
      lastPrice,
      dailyReturn,
      monthlyReturn: prev?.monthlyReturn ?? fund.monthlyReturn,
      yearlyReturn: prev?.yearlyReturn ?? fund.yearlyReturn,
      portfolioSize,
      investorCount,
      alpha: prev?.alpha ?? 0,
      sparkline: JSON.parse(JSON.stringify(sparkline)),
      scores: prev?.scores ?? JSON.parse(JSON.stringify({})),
      metrics: prev?.metrics ?? JSON.parse(JSON.stringify({})),
      finalScoreBest: prev?.finalScoreBest ?? 0,
      finalScoreLowRisk: prev?.finalScoreLowRisk ?? 0,
      finalScoreHighReturn: prev?.finalScoreHighReturn ?? 0,
      finalScoreStable: prev?.finalScoreStable ?? 0,
    };
  });

  await prisma.$transaction(
    async (tx) => {
      await tx.fundDailySnapshot.deleteMany({ where: { date: sessionDate } });
      for (let i = 0; i < rows.length; i += 500) {
        await tx.fundDailySnapshot.createMany({ data: rows.slice(i, i + 500) });
      }
      await tx.fundDailySnapshot.deleteMany({ where: { date: { lt: retentionCutoff } } });
    },
    { maxWait: 15_000, timeout: 90_000 }
  );

  return {
    written: rows.length,
    scannedFunds: funds.length,
    fundsWithCurrentHistory,
    fundsCarriedForward,
    carriedFromPreviousRows,
    newlyInitializedRows,
    previousSnapshotDate: latestPrevious.date.toISOString(),
    fallbackToFullRebuild: false,
  };
}

async function rebuildMarketSnapshotFromDailySnapshot(snapshotDate: Date): Promise<void> {
  const sessionDayStart = startOfUtcDay(snapshotDate);
  await prisma.$transaction(async (tx) => {
    const all = await tx.fundDailySnapshot.findMany({
      where: { date: sessionDayStart },
      select: { dailyReturn: true, portfolioSize: true, investorCount: true },
    });
    const directionCounts = countDailyReturnDirections(all.map((fund) => fund.dailyReturn));
    const advancers = directionCounts.advancers;
    const decliners = directionCounts.decliners;
    const unchanged = directionCounts.unchanged;
    const rets = all.map((fund) => fund.dailyReturn).filter((value) => classifyDailyReturnPctPoints2dp(value) !== "neutral");
    const avgDailyReturn = rets.length > 0 ? rets.reduce((acc, value) => acc + value, 0) / rets.length : 0;

    await tx.marketSnapshot.upsert({
      where: { date: sessionDayStart },
      create: {
        date: sessionDayStart,
        totalFundCount: all.length,
        totalPortfolioSize: all.reduce((acc, fund) => acc + fund.portfolioSize, 0),
        totalInvestorCount: all.reduce((acc, fund) => acc + fund.investorCount, 0),
        avgDailyReturn,
        advancers,
        decliners,
        unchanged,
      },
      update: {
        totalFundCount: all.length,
        totalPortfolioSize: all.reduce((acc, fund) => acc + fund.portfolioSize, 0),
        totalInvestorCount: all.reduce((acc, fund) => acc + fund.investorCount, 0),
        avgDailyReturn,
        advancers,
        decliners,
        unchanged,
      },
    });
  });

  const rates = await fetchUsdTryEurTryLive();
  if (rates) {
    await prisma.marketSnapshot.updateMany({
      where: { date: sessionDayStart },
      data: { usdTry: rates.usdTry, eurTry: rates.eurTry },
    });
  }
}

async function runServingCore(options: { warmCaches: boolean; incrementalDaily: boolean }): Promise<ServingRebuildResult | ServingDailyRefreshResult> {
  const runStartedAt = Date.now();
  const steps: ServingStepTiming[] = [];
  const markStep = async <T>(name: string, runner: () => Promise<T>, details?: Record<string, unknown>): Promise<T> => {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    console.info("[serving-rebuild] step_start", { name, startedAt, ...details });
    try {
      const result = await runner();
      const finishedAtMs = Date.now();
      const finishedAt = new Date(finishedAtMs).toISOString();
      const durationMs = finishedAtMs - startedAtMs;
      const payload = { name, startedAt, finishedAt, durationMs, details };
      steps.push(payload);
      console.info("[serving-rebuild] step_done", payload);
      return result;
    } catch (error) {
      const finishedAtMs = Date.now();
      const finishedAt = new Date(finishedAtMs).toISOString();
      const durationMs = finishedAtMs - startedAtMs;
      const causeMessage = error instanceof Error ? error.message : String(error);
      console.error("[serving-rebuild] step_failed", {
        name,
        startedAt,
        finishedAt,
        durationMs,
        details,
        causeMessage,
      });
      throw new ServingStepError({
        stepName: name,
        startedAt,
        finishedAt,
        durationMs,
        details,
        cause: error,
      });
    }
  };

  const snapshotDate = await resolveLatestSnapshotDate();
  console.info("[serving-rebuild] start", {
    snapshotDate: snapshotDate.toISOString(),
    warmCaches: options.warmCaches,
    incrementalDaily: options.incrementalDaily,
  });

  const fundStats = options.incrementalDaily
    ? { updatedFunds: 0 }
    : await markStep("sync_fund_stats", () => syncFundServingStatsFromHistory(snapshotDate));
  const returns = options.incrementalDaily
    ? { updatedFunds: 0 }
    : await markStep("recompute_returns", () => recomputeFundReturnsFromHistory({ targetSessionDate: snapshotDate }));

  let serving:
    | IncrementalSnapshotResult
    | Awaited<ReturnType<typeof rebuildFundDailySnapshots>>;
  if (options.incrementalDaily) {
    serving = await markStep("rebuild_daily_snapshots_incremental", () => rebuildFundDailySnapshotsIncremental(snapshotDate));
    await markStep("rebuild_market_snapshot_from_snapshot", () => rebuildMarketSnapshotFromDailySnapshot(snapshotDate));
  } else {
    await markStep("rebuild_market_snapshot", () => rebuildMarketSnapshot(snapshotDate));
    serving = await markStep("rebuild_daily_snapshots_full", () => rebuildFundDailySnapshots(snapshotDate));
  }

  const derived = options.incrementalDaily
    ? ({ written: 0 } as const)
    : await markStep("rebuild_derived_metrics", () => rebuildFundDerivedMetrics());

  const detailCore = await markStep("rebuild_fund_detail_core_serving_cache", () =>
    rebuildFundDetailCoreServingCache({ sourceDate: snapshotDate })
  );

  const warm = options.warmCaches
    ? await markStep("warm_scores_cache", () => warmAllScoresApiCaches())
    : { written: 0 };

  await refreshFundHistorySyncState({
    phase: options.incrementalDaily ? "serving_daily_incremental" : "serving_rebuild",
    source: "src/lib/services/serving-rebuild.service.ts",
    lastDerivedRebuild: {
      snapshotDate: snapshotDate.toISOString(),
      updatedFunds: returns.updatedFunds,
      updatedFundStats: fundStats.updatedFunds,
      writtenSnapshots: serving.written,
      writtenDerivedMetrics: derived.written,
      writtenDetailCore: detailCore.written,
      warmedCaches: warm.written,
      completedAt: new Date().toISOString(),
      incrementalDaily: options.incrementalDaily,
    },
  });

  const result: ServingRebuildResult = {
    snapshotDate: snapshotDate.toISOString(),
    fundStats,
    returns,
    serving: { written: serving.written },
    derived: { written: derived.written },
    detailCore: { written: detailCore.written },
    warm: { written: warm.written },
    timings: {
      totalMs: Date.now() - runStartedAt,
      steps,
    },
  };

  if (!options.incrementalDaily) {
    return result;
  }

  return {
    ...result,
    mode: "incremental_daily",
    deferred: {
      derived: true,
      // Günlük kritik path'te history-wide recompute/stat sync koşmuyoruz.
      warmCaches: !options.warmCaches,
    },
  };
}

export async function runServingRebuild(options?: { warmCaches?: boolean }): Promise<ServingRebuildResult> {
  return runServingCore({ warmCaches: options?.warmCaches !== false, incrementalDaily: false }) as Promise<ServingRebuildResult>;
}

export async function runServingDailyIncremental(options?: { warmCaches?: boolean }): Promise<ServingDailyRefreshResult> {
  return runServingCore({ warmCaches: options?.warmCaches === true, incrementalDaily: true }) as Promise<ServingDailyRefreshResult>;
}

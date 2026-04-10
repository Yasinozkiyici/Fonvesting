import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import { rebuildFundDailySnapshots } from "@/lib/services/fund-daily-snapshot.service";
import { rebuildFundDerivedMetrics } from "@/lib/services/fund-derived-metrics.service";
import { warmAllScoresApiCaches } from "@/lib/services/fund-scores-cache.service";
import { refreshFundHistorySyncState } from "@/lib/services/tefas-history.service";
import { rebuildMarketSnapshot, recomputeFundReturnsFromHistory } from "@/lib/services/tefas-sync.service";

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

export async function runServingRebuild(options?: {
  warmCaches?: boolean;
}): Promise<ServingRebuildResult> {
  const snapshotDate = await resolveLatestSnapshotDate();
  console.info("[serving-rebuild] start", { snapshotDate: snapshotDate.toISOString(), warmCaches: options?.warmCaches !== false });
  const fundStats = await syncFundServingStatsFromHistory(snapshotDate);
  console.info("[serving-rebuild] fund_stats_synced", fundStats);
  const returns = await recomputeFundReturnsFromHistory({ targetSessionDate: snapshotDate });
  console.info("[serving-rebuild] returns_recomputed", returns);
  await rebuildMarketSnapshot(snapshotDate);
  console.info("[serving-rebuild] market_snapshot_rebuilt", { snapshotDate: snapshotDate.toISOString() });
  const serving = await rebuildFundDailySnapshots(snapshotDate);
  console.info("[serving-rebuild] daily_snapshots_rebuilt", serving);
  const derived = await rebuildFundDerivedMetrics();
  console.info("[serving-rebuild] derived_metrics_rebuilt", derived);
  const warm = options?.warmCaches === false ? { written: 0 } : await warmAllScoresApiCaches();
  console.info("[serving-rebuild] scores_cache_warmed", warm);

  await refreshFundHistorySyncState({
    phase: "serving_rebuild",
    source: "src/lib/services/serving-rebuild.service.ts",
    lastDerivedRebuild: {
      snapshotDate: snapshotDate.toISOString(),
      updatedFunds: returns.updatedFunds,
      updatedFundStats: fundStats.updatedFunds,
      writtenSnapshots: serving.written,
      writtenDerivedMetrics: derived.written,
      warmedCaches: warm.written,
      completedAt: new Date().toISOString(),
    },
  });

  return {
    snapshotDate: snapshotDate.toISOString(),
    fundStats,
    returns,
    serving,
    derived,
    warm,
  };
}

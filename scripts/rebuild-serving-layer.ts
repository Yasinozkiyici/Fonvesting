import "./load-env";
import { prisma } from "../src/lib/prisma";
import { rebuildFundDailySnapshots } from "../src/lib/services/fund-daily-snapshot.service";
import { rebuildFundDerivedMetrics } from "../src/lib/services/fund-derived-metrics.service";
import { rebuildFundDetailCoreServingCache } from "../src/lib/services/fund-detail-core-serving.service";
import { warmAllScoresApiCaches } from "../src/lib/services/fund-scores-cache.service";
import { recomputeFundReturnsFromHistory, rebuildMarketSnapshot } from "../src/lib/services/tefas-sync.service";

async function main() {
  const latestHistory = await prisma.fundPriceHistory.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });

  if (!latestHistory?.date) {
    throw new Error("latest_history_missing");
  }

  const snapshotDate = latestHistory.date;
  console.log(`[rebuild-serving] snapshotDate=${snapshotDate.toISOString()}`);

  const returns = await recomputeFundReturnsFromHistory({ targetSessionDate: snapshotDate });
  console.log(`[rebuild-serving] returns updatedFunds=${returns.updatedFunds}`);

  await rebuildMarketSnapshot(snapshotDate);
  console.log("[rebuild-serving] market snapshot rebuilt");

  const serving = await rebuildFundDailySnapshots(snapshotDate);
  console.log(`[rebuild-serving] fund daily snapshots written=${serving.written}`);

  const derived = await rebuildFundDerivedMetrics();
  console.log(`[rebuild-serving] derived metrics written=${derived.written}`);

  const detailCore = await rebuildFundDetailCoreServingCache({ sourceDate: snapshotDate });
  console.log(
    `[rebuild-serving] detail core serving written=${detailCore.written} scannedRows=${detailCore.scannedRows}`
  );

  const warm = await warmAllScoresApiCaches();
  console.log(`[rebuild-serving] scores cache written=${warm.written}`);
}

main()
  .catch((error) => {
    console.error("[rebuild-serving] failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

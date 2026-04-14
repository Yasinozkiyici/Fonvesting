import "./load-env";
import { prisma } from "../src/lib/prisma";
import { getFundDetailCoreServingCached } from "../src/lib/services/fund-detail-core-serving.service";

async function main() {
  const code = (process.argv[2] ?? "VGA").trim().toUpperCase();
  const count = await prisma.scoresApiCache.count({
    where: { cacheKey: { startsWith: "fund_detail_core:v1:" } },
  });
  const sample = await getFundDetailCoreServingCached(code);
  console.log(
    JSON.stringify(
      {
        count,
        code,
        source: sample.source,
        readMs: sample.readMs,
        ageMs: sample.ageMs,
        hasPayload: Boolean(sample.payload),
        latestPrice: sample.payload?.latestPrice ?? null,
        seriesPoints: sample.payload?.miniPriceSeries.length ?? 0,
        chartHistoryPoints: sample.payload?.chartHistory?.points?.length ?? 0,
        chartHistoryMode: sample.payload?.chartHistory?.mode ?? null,
        chartHistoryMinDate: sample.payload?.chartHistory?.minDate ?? null,
        chartHistoryMaxDate: sample.payload?.chartHistory?.maxDate ?? null,
        investorCurrent: sample.payload?.investorSummary.current ?? null,
        portfolioCurrent: sample.payload?.portfolioSummary.current ?? null,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("[check-fund-detail-core-serving] failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

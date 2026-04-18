import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeServingBuildId } from "@/lib/domain/serving/build-id";
import { getFundDetailCoreServingUniversePayloads } from "@/lib/services/fund-detail-core-serving.service";

type CanonicalRow = {
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  fundTypeCode: number | null;
  fundTypeName: string | null;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
};

export type V2ServingRebuildResult = {
  buildId: string;
  snapshotAsOf: string;
  listRows: number;
  detailRows: number;
  compareRows: number;
  discoveryRows: number;
  parseFailureCount: number;
  failedSourceCount: number;
  fundCoverageRatio: number;
};

export async function rebuildV2ServingWorld(snapshotDate: Date): Promise<V2ServingRebuildResult> {
  const snapshotAsOf = snapshotDate.toISOString();
  const [canonicalRows, activeFunds, rawParseFailures, rawFailedSources, coreUniverse] = await Promise.all([
    prisma.fundDailySnapshot.findMany({
      where: { date: snapshotDate },
      select: {
        fundId: true,
        code: true,
        name: true,
        shortName: true,
        categoryCode: true,
        categoryName: true,
        fundTypeCode: true,
        fundTypeName: true,
        lastPrice: true,
        dailyReturn: true,
        monthlyReturn: true,
        yearlyReturn: true,
        portfolioSize: true,
        investorCount: true,
      },
      orderBy: [{ portfolioSize: "desc" }, { code: "asc" }],
    }),
    prisma.fund.count({ where: { isActive: true } }),
    prisma.rawPricesPayload.count({ where: { parseStatus: "FAILED" } }).catch(() => 0),
    prisma.rawPricesPayload.groupBy({ by: ["sourceKey"], where: { parseStatus: "FAILED" } }).then((rows) => rows.length).catch(() => 0),
    getFundDetailCoreServingUniversePayloads().catch(() => ({ records: [], source: "none" as const, missReason: "cache_empty" as const })),
  ]);

  const buildId = computeServingBuildId({
    snapshotAsOfIso: snapshotAsOf,
    pipelineRunKey: `v2:${canonicalRows.length}`,
    gitCommitShort: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? null,
  });

  const listPayload = {
    buildId,
    snapshotAsOf,
    total: canonicalRows.length,
    funds: canonicalRows.map((row) => ({
      code: row.code,
      name: row.name,
      shortName: row.shortName,
      categoryCode: row.categoryCode,
      fundTypeCode: row.fundTypeCode,
      lastPrice: row.lastPrice,
      dailyReturn: row.dailyReturn,
      monthlyReturn: row.monthlyReturn,
      yearlyReturn: row.yearlyReturn,
      portfolioSize: row.portfolioSize,
      investorCount: row.investorCount,
    })),
  };

  const comparePayload = {
    buildId,
    snapshotAsOf,
    funds: canonicalRows.map((row) => ({
      code: row.code,
      categoryCode: row.categoryCode,
      dailyReturn: row.dailyReturn,
      monthlyReturn: row.monthlyReturn,
      yearlyReturn: row.yearlyReturn,
      portfolioSize: row.portfolioSize,
      investorCount: row.investorCount,
    })),
  };

  const discoveryPayload = {
    buildId,
    snapshotAsOf,
    funds: canonicalRows.map((row, index) => ({
      rank: index + 1,
      code: row.code,
      score: Number((row.dailyReturn * 0.3 + row.monthlyReturn * 0.2 + row.yearlyReturn * 0.5).toFixed(4)),
      categoryCode: row.categoryCode,
      portfolioSize: row.portfolioSize,
    })),
  };

  const detailByCode = new Map(coreUniverse.records.map((record) => [record.fund.code.trim().toUpperCase(), record]));
  const details = canonicalRows.map((row) => {
    const servingDetail = detailByCode.get(row.code.trim().toUpperCase());
    const payload = servingDetail
      ? servingDetail
      : {
          buildId,
          snapshotAsOf,
          fund: { code: row.code, name: row.name, shortName: row.shortName },
          latestPrice: row.lastPrice,
          dailyReturn: row.dailyReturn,
          monthlyReturn: row.monthlyReturn,
          yearlyReturn: row.yearlyReturn,
          categoryCode: row.categoryCode,
          categoryName: row.categoryName,
          fundTypeCode: row.fundTypeCode,
          fundTypeName: row.fundTypeName,
          chartSeries: [],
        };
    return { code: row.code, payload };
  });

  const systemPayload = {
    buildId,
    snapshotAsOf,
    counts: {
      canonical: canonicalRows.length,
      details: details.length,
      parseFailures: rawParseFailures,
      failedSources: rawFailedSources,
    },
    alignment: {
      listBuildId: buildId,
      detailBuildId: buildId,
      compareBuildId: buildId,
      discoveryBuildId: buildId,
      aligned: true,
    },
  };

  await prisma.$transaction(
    async (tx) => {
      // Idempotent rebuild: same deterministic buildId can be produced again for the same snapshot.
      // Replace the previous build envelope/details atomically instead of failing on unique buildId.
      await tx.servingFundDetail.deleteMany({ where: { buildId } });
      await tx.servingFundList.deleteMany({ where: { buildId } });
      await tx.servingCompareInputs.deleteMany({ where: { buildId } });
      await tx.servingDiscoveryIndex.deleteMany({ where: { buildId } });
      await tx.servingSystemStatus.deleteMany({ where: { buildId } });

      await tx.servingFundList.create({
        data: {
          buildId,
          snapshotAsOf: snapshotDate,
          status: "ready",
          payload: listPayload as Prisma.InputJsonValue,
          meta: { layer: "v2", rows: canonicalRows.length } as Prisma.InputJsonValue,
        },
      });
      await tx.servingCompareInputs.create({
        data: {
          buildId,
          snapshotAsOf: snapshotDate,
          status: "ready",
          payload: comparePayload as Prisma.InputJsonValue,
          meta: { layer: "v2", rows: canonicalRows.length } as Prisma.InputJsonValue,
        },
      });
      await tx.servingDiscoveryIndex.create({
        data: {
          buildId,
          snapshotAsOf: snapshotDate,
          status: "ready",
          payload: discoveryPayload as Prisma.InputJsonValue,
          meta: { layer: "v2", rows: canonicalRows.length } as Prisma.InputJsonValue,
        },
      });
      await tx.servingSystemStatus.create({
        data: {
          buildId,
          snapshotAsOf: snapshotDate,
          status: "ready",
          payload: systemPayload as Prisma.InputJsonValue,
          meta: { layer: "v2" } as Prisma.InputJsonValue,
        },
      });

      for (const chunkStart of Array.from({ length: Math.ceil(details.length / 250) }, (_, i) => i * 250)) {
        const chunk = details.slice(chunkStart, chunkStart + 250);
        if (chunk.length === 0) continue;
        await tx.servingFundDetail.createMany({
          data: chunk.map((item) => ({
            buildId,
            fundCode: item.code,
            snapshotAsOf: snapshotDate,
            status: "ready",
            payload: item.payload as Prisma.InputJsonValue,
            meta: { layer: "v2" } as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        });
      }
    },
    // Detail payload write can exceed the default interactive transaction timeout
    // in migrated datasets (~2k+ funds). Keep a single-world atomic write behavior.
    { timeout: 900_000, maxWait: 120_000 }
  );

  return {
    buildId,
    snapshotAsOf,
    listRows: canonicalRows.length,
    detailRows: details.length,
    compareRows: canonicalRows.length,
    discoveryRows: canonicalRows.length,
    parseFailureCount: rawParseFailures,
    failedSourceCount: rawFailedSources,
    fundCoverageRatio: activeFunds > 0 ? Number((canonicalRows.length / activeFunds).toFixed(4)) : 0,
  };
}

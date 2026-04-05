import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import {
  buildNormalizationContext,
  calculateAllMetrics,
  calculateAlpha,
  calculateFinalScore,
  calculateNormalizedScoresWithContext,
  determineRiskLevel,
  type FundMetrics,
  type NormalizedScores,
  type PricePoint,
  type RankingMode,
  type RiskLevel,
} from "@/lib/scoring";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import { fundTypeDisplayLabel } from "@/lib/fund-type-display";
import { getCachedUsdTryEurTry, mergeSnapshotFx } from "@/lib/services/exchange-rates.service";
import type { ScoresApiPayload, ScoredFundRow } from "@/lib/services/fund-scores-compute.service";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Günlük snapshot satırları: ~2 yıl tutulur (eski günler silinir). */
const SNAPSHOT_RETENTION_DAYS = 730;
const HISTORY_BATCH = 4000;
const SPARKLINE_POINTS = 7;
/** Metrik / skor için yüklenecek fiyat geçmişi: ~2 yıl + tampon. */
export const FUND_PRICE_HISTORY_LOOKBACK_DAYS = 760;
const RETURN_LOOKBACK_DAYS = FUND_PRICE_HISTORY_LOOKBACK_DAYS;

function isRelationMissingError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

type FundRow = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  category: { code: string; name: string } | null;
  fundType: { code: number; name: string } | null;
};

type SnapshotRecord = {
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  fundTypeCode: number | null;
  fundTypeName: string | null;
  riskLevel: RiskLevel;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  alpha: number;
  sparkline: number[];
  scores: NormalizedScores;
  metrics: FundMetrics;
  finalScoreBest: number;
  finalScoreLowRisk: number;
  finalScoreHighReturn: number;
  finalScoreStable: number;
};

export type CategorySnapshotSummary = {
  id: string;
  code: string;
  name: string;
  color: string | null;
  description: string | null;
  fundCount: number;
  avgDailyReturn: number;
  totalPortfolioSize: number;
};

export type MarketSnapshotSummaryPayload = {
  summary: { avgDailyReturn: number; totalFundCount: number };
  fundCount: number;
  totalPortfolioSize: number;
  totalInvestorCount: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  lastSyncedAt: string | null;
  snapshotDate: string | null;
  usdTry: number | null;
  eurTry: number | null;
  topGainers: Array<{
    code: string;
    name: string;
    shortName: string | null;
    lastPrice: number;
    dailyReturn: number;
    portfolioSize: number;
  }>;
  topLosers: Array<{
    code: string;
    name: string;
    shortName: string | null;
    lastPrice: number;
    dailyReturn: number;
    portfolioSize: number;
  }>;
  formatted: {
    totalPortfolioSize: string;
    totalInvestorCount: string;
  };
};

async function loadPriceHistoryByFundId(
  fundIds: string[],
  fromDate: Date
): Promise<Map<string, Array<{ date: Date; price: number }>>> {
  const map = new Map<string, Array<{ date: Date; price: number }>>();
  if (fundIds.length === 0) return map;

  for (let i = 0; i < fundIds.length; i += HISTORY_BATCH) {
    const chunk = fundIds.slice(i, i + HISTORY_BATCH);
    const rows = await prisma.fundPriceHistory.findMany({
      where: {
        fundId: { in: chunk },
        date: { gte: fromDate },
      },
      orderBy: [{ fundId: "asc" }, { date: "asc" }],
      select: { fundId: true, date: true, price: true },
    });

    for (const row of rows) {
      const arr = map.get(row.fundId) ?? [];
      arr.push({ date: row.date, price: row.price });
      map.set(row.fundId, arr);
    }
  }

  return map;
}

export type FundPerformanceMetrics = {
  lastPrice: number;
  previousPrice: number;
  dailyReturn: number;
  weeklyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  sparkline: number[];
  pricePoints: PricePoint[];
};

function formatNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(2)} Trilyon`;
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} Milyar`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} Milyon`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(2)} Bin`;
  return n.toFixed(2);
}

function formatTL(n: number): string {
  return `₺${formatNumber(n)}`;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function clampReturn(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > 1000) return 0;
  return Number(value.toFixed(4));
}

function pctChange(prev: number, current: number): number {
  if (!Number.isFinite(prev) || !Number.isFinite(current) || prev <= 0) return 0;
  return ((current - prev) / prev) * 100;
}

function normalizeHistorySessionDate(date: Date): Date {
  return startOfUtcDay(new Date(date.getTime() + 3 * 60 * 60 * 1000));
}

function dedupeSessionPricePoints(rows: Array<{ date: Date; price: number }>): PricePoint[] {
  const sessions = new Map<number, PricePoint>();
  for (const row of rows) {
    if (!Number.isFinite(row.price) || row.price <= 0) continue;
    const sessionDate = normalizeHistorySessionDate(row.date);
    sessions.set(sessionDate.getTime(), { date: sessionDate, price: row.price });
  }
  return [...sessions.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

function compressConsecutiveDuplicatePrices(points: PricePoint[]): PricePoint[] {
  const compressed: PricePoint[] = [];
  for (const point of points) {
    const prev = compressed.at(-1);
    if (prev && Math.abs(prev.price - point.price) < 1e-9) continue;
    compressed.push(point);
  }
  return compressed;
}

function findClosestPointOnOrBefore(points: PricePoint[], targetDate: Date): PricePoint | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i];
    if (point && point.date.getTime() <= targetDate.getTime()) return point;
  }
  return null;
}

export function deriveFundPerformanceFromHistory(rows: Array<{ date: Date; price: number }>): FundPerformanceMetrics {
  const pricePoints = compressConsecutiveDuplicatePrices(dedupeSessionPricePoints(rows));
  const latest = pricePoints.at(-1);
  const previous = pricePoints.length >= 2 ? pricePoints[pricePoints.length - 2] : null;

  if (!latest) {
    return {
      lastPrice: 0,
      previousPrice: 0,
      dailyReturn: 0,
      weeklyReturn: 0,
      monthlyReturn: 0,
      yearlyReturn: 0,
      sparkline: [],
      pricePoints: [],
    };
  }

  const currentDate = latest.date;
  const weeklyBase = findClosestPointOnOrBefore(pricePoints, new Date(currentDate.getTime() - 7 * DAY_MS));
  const monthlyBase = findClosestPointOnOrBefore(pricePoints, new Date(currentDate.getTime() - 30 * DAY_MS));
  const yearlyBase = findClosestPointOnOrBefore(pricePoints, new Date(currentDate.getTime() - 365 * DAY_MS));

  return {
    lastPrice: latest.price,
    previousPrice: previous?.price ?? latest.price,
    dailyReturn: clampReturn(previous ? pctChange(previous.price, latest.price) : 0),
    weeklyReturn: clampReturn(weeklyBase ? pctChange(weeklyBase.price, latest.price) : 0),
    monthlyReturn: clampReturn(monthlyBase ? pctChange(monthlyBase.price, latest.price) : 0),
    yearlyReturn: clampReturn(yearlyBase ? pctChange(yearlyBase.price, latest.price) : 0),
    sparkline: pricePoints.slice(-SPARKLINE_POINTS).map((point) => point.price),
    pricePoints,
  };
}

function scoreField(mode: RankingMode): keyof Pick<
  SnapshotRecord,
  "finalScoreBest" | "finalScoreLowRisk" | "finalScoreHighReturn" | "finalScoreStable"
> {
  if (mode === "LOW_RISK") return "finalScoreLowRisk";
  if (mode === "HIGH_RETURN") return "finalScoreHighReturn";
  if (mode === "STABLE") return "finalScoreStable";
  return "finalScoreBest";
}

function buildSnapshotRecords(fundRows: FundRow[], historyByFund: Map<string, Array<{ date: Date; price: number }>>): SnapshotRecord[] {
  const computed = fundRows.map((fund) => {
    const performance = deriveFundPerformanceFromHistory(historyByFund.get(fund.id) ?? []);
    const pricePoints = performance.pricePoints.length
      ? performance.pricePoints
      : fund.lastPrice > 0
        ? [{ date: new Date(), price: fund.lastPrice }]
        : [];

    const metrics = calculateAllMetrics(pricePoints);
    if (metrics.dataPoints < 2 && performance.dailyReturn !== 0) {
      metrics.annualizedReturn = performance.dailyReturn * 252;
      metrics.totalReturn = performance.dailyReturn;
    }

    return { fund, metrics, pricePoints, performance };
  });

  const normCtx = buildNormalizationContext(computed.map((item) => item.metrics));

  return computed.map(({ fund, metrics, performance }) => {
    const scores = calculateNormalizedScoresWithContext(metrics, normCtx);
    const riskLevel = determineRiskLevel(fund.category?.code ?? "DGR", fund.name);
    const alpha = calculateAlpha(metrics.annualizedReturn, fund.category?.code ?? "DGR");

    return {
      fundId: fund.id,
      code: fund.code,
      name: fund.name,
      shortName: fund.shortName,
      logoUrl: getFundLogoUrlForUi(fund.id, fund.code, fund.logoUrl, fund.name),
      categoryCode: fund.category?.code ?? null,
      categoryName: fund.category?.name ?? null,
      fundTypeCode: fund.fundType?.code ?? null,
      fundTypeName: fund.fundType ? fundTypeDisplayLabel(fund.fundType) : null,
      riskLevel,
      lastPrice: performance.lastPrice || fund.lastPrice,
      dailyReturn: performance.dailyReturn,
      monthlyReturn: performance.monthlyReturn,
      yearlyReturn: performance.yearlyReturn,
      portfolioSize: fund.portfolioSize,
      investorCount: fund.investorCount,
      alpha,
      sparkline: performance.sparkline,
      scores,
      metrics,
      finalScoreBest: calculateFinalScore(scores, "BEST"),
      finalScoreLowRisk: calculateFinalScore(scores, "LOW_RISK"),
      finalScoreHighReturn: calculateFinalScore(scores, "HIGH_RETURN"),
      finalScoreStable: calculateFinalScore(scores, "STABLE"),
    };
  });
}

function snapshotRowToScoredFund(row: {
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  categoryCode: string | null;
  categoryName: string | null;
  fundTypeCode: number | null;
  fundTypeName: string | null;
  riskLevel: string;
  alpha: number;
  sparkline: Prisma.JsonValue;
  scores: Prisma.JsonValue;
  metrics: Prisma.JsonValue;
  finalScoreBest: number;
  finalScoreLowRisk: number;
  finalScoreHighReturn: number;
  finalScoreStable: number;
}, mode: RankingMode): ScoredFundRow {
  const finalField = scoreField(mode);

  return {
    fundId: row.fundId,
    code: row.code,
    name: row.name,
    shortName: row.shortName,
    logoUrl: row.logoUrl,
    lastPrice: row.lastPrice,
    dailyReturn: row.dailyReturn,
    monthlyReturn: row.monthlyReturn,
    yearlyReturn: row.yearlyReturn,
    portfolioSize: row.portfolioSize,
    investorCount: row.investorCount,
    category: row.categoryCode && row.categoryName ? { code: row.categoryCode, name: row.categoryName } : null,
    fundType:
      row.fundTypeCode != null && row.fundTypeName
        ? {
            code: row.fundTypeCode,
            name: fundTypeDisplayLabel({ code: row.fundTypeCode, name: row.fundTypeName }),
          }
        : null,
    finalScore: row[finalField],
    riskLevel: row.riskLevel as RiskLevel,
    scores: row.scores as unknown as NormalizedScores,
    metrics: row.metrics as unknown as FundMetrics,
    alpha: row.alpha,
    sparkline: row.sparkline as unknown as number[],
  };
}

export async function rebuildFundDailySnapshots(snapshotDate: Date): Promise<{ written: number }> {
  const fromDate = new Date(snapshotDate.getTime() - RETURN_LOOKBACK_DAYS * DAY_MS);
  const fundRows = (await prisma.fund.findMany({
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
    orderBy: { portfolioSize: "desc" },
  })) as FundRow[];

  const historyByFund = await loadPriceHistoryByFundId(
    fundRows.map((fund) => fund.id),
    fromDate
  );

  const records = buildSnapshotRecords(fundRows, historyByFund);
  const retentionCutoff = new Date(snapshotDate.getTime() - SNAPSHOT_RETENTION_DAYS * DAY_MS);

  await prisma.$transaction(async (tx) => {
    await tx.fundDailySnapshot.deleteMany({ where: { date: snapshotDate } });

    for (let i = 0; i < records.length; i += 250) {
      const slice = records.slice(i, i + 250);
      await tx.fundDailySnapshot.createMany({
        data: slice.map((row) => ({
          date: snapshotDate,
          fundId: row.fundId,
          code: row.code,
          name: row.name,
          shortName: row.shortName,
          logoUrl: row.logoUrl,
          categoryCode: row.categoryCode,
          categoryName: row.categoryName,
          fundTypeCode: row.fundTypeCode,
          fundTypeName: row.fundTypeName,
          riskLevel: row.riskLevel,
          lastPrice: row.lastPrice,
          dailyReturn: row.dailyReturn,
          monthlyReturn: row.monthlyReturn,
          yearlyReturn: row.yearlyReturn,
          portfolioSize: row.portfolioSize,
          investorCount: row.investorCount,
          alpha: row.alpha,
          sparkline: toJson(row.sparkline),
          scores: toJson(row.scores),
          metrics: toJson(row.metrics),
          finalScoreBest: row.finalScoreBest,
          finalScoreLowRisk: row.finalScoreLowRisk,
          finalScoreHighReturn: row.finalScoreHighReturn,
          finalScoreStable: row.finalScoreStable,
        })),
      });
    }

    await tx.fundDailySnapshot.deleteMany({
      where: { date: { lt: retentionCutoff } },
    });
  });

  return { written: records.length };
}

export async function getScoresPayloadFromDailySnapshot(
  mode: RankingMode,
  categoryKey: string
): Promise<ScoresApiPayload | null> {
  let latest: { date: Date } | null = null;
  try {
    latest = await prisma.fundDailySnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    });
  } catch (error) {
    if (isRelationMissingError(error)) return null;
    throw error;
  }
  if (!latest) return null;

  let rows;
  try {
    rows = await prisma.fundDailySnapshot.findMany({
      where: {
        date: latest.date,
        ...(categoryKey ? { categoryCode: categoryKey } : {}),
      },
      select: {
        fundId: true,
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
        categoryCode: true,
        categoryName: true,
        fundTypeCode: true,
        fundTypeName: true,
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
  } catch (error) {
    if (isRelationMissingError(error)) return null;
    throw error;
  }

  const funds = rows
    .map((row) => snapshotRowToScoredFund(row, mode))
    .sort((a, b) => b.finalScore - a.finalScore);

  return {
    mode,
    total: funds.length,
    funds,
  };
}

export async function getCategorySummariesFromDailySnapshot(): Promise<CategorySnapshotSummary[]> {
  try {
    const latest = await prisma.fundDailySnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    });
    if (!latest) return [];

    const [categories, rows] = await Promise.all([
      prisma.fundCategory.findMany({ orderBy: { name: "asc" } }),
      prisma.fundDailySnapshot.findMany({
        where: { date: latest.date },
        select: {
          categoryCode: true,
          dailyReturn: true,
          portfolioSize: true,
        },
      }),
    ]);

    const stats = new Map<string, { fundCount: number; sumDailyReturn: number; totalPortfolioSize: number }>();
    for (const row of rows) {
      if (!row.categoryCode) continue;
      const current = stats.get(row.categoryCode) ?? { fundCount: 0, sumDailyReturn: 0, totalPortfolioSize: 0 };
      current.fundCount += 1;
      current.sumDailyReturn += row.dailyReturn;
      current.totalPortfolioSize += row.portfolioSize;
      stats.set(row.categoryCode, current);
    }

    return categories.map((category) => {
      const current = stats.get(category.code);
      return {
        id: category.id,
        code: category.code,
        name: category.name,
        color: category.color,
        description: category.description,
        fundCount: current?.fundCount ?? 0,
        avgDailyReturn: current?.fundCount ? Number((current.sumDailyReturn / current.fundCount).toFixed(4)) : 0,
        totalPortfolioSize: current?.totalPortfolioSize ?? 0,
      };
    });
  } catch (error) {
    if (!isRelationMissingError(error)) throw error;

    const [categories, byCategory] = await Promise.all([
      prisma.fundCategory.findMany({ orderBy: { name: "asc" } }),
      prisma.fund.groupBy({
        by: ["categoryId"],
        where: { isActive: true },
        _count: { _all: true },
        _avg: { dailyReturn: true },
        _sum: { portfolioSize: true },
      }),
    ]);

    const stats = new Map(
      byCategory
        .filter((row): row is typeof row & { categoryId: string } => row.categoryId != null)
        .map((row) => [
          row.categoryId,
          {
            fundCount: row._count._all,
            avgDailyReturn: Number((row._avg.dailyReturn ?? 0).toFixed(4)),
            totalPortfolioSize: row._sum.portfolioSize ?? 0,
          },
        ])
    );

    return categories.map((category) => {
      const current = stats.get(category.id);
      return {
        id: category.id,
        code: category.code,
        name: category.name,
        color: category.color,
        description: category.description,
        fundCount: current?.fundCount ?? 0,
        avgDailyReturn: current?.avgDailyReturn ?? 0,
        totalPortfolioSize: current?.totalPortfolioSize ?? 0,
      };
    });
  }
}

export async function getMarketSummaryFromDailySnapshot(): Promise<MarketSnapshotSummaryPayload | null> {
  try {
    const latest = await prisma.fundDailySnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true, updatedAt: true },
    });
    if (!latest) return null;

    const [rows, marketSnapshot] = await Promise.all([
      prisma.fundDailySnapshot.findMany({
        where: { date: latest.date },
        select: {
          code: true,
          name: true,
          shortName: true,
          lastPrice: true,
          dailyReturn: true,
          portfolioSize: true,
          investorCount: true,
        },
      }),
      prisma.marketSnapshot.findUnique({
        where: { date: latest.date },
      }),
    ]);

    const fundCount = rows.length;
    const totalPortfolioSize = rows.reduce((sum, row) => sum + row.portfolioSize, 0);
    const totalInvestorCount = rows.reduce((sum, row) => sum + row.investorCount, 0);
    const advancers = rows.filter((row) => row.dailyReturn > 0).length;
    const decliners = rows.filter((row) => row.dailyReturn < 0).length;
    const unchanged = Math.max(0, fundCount - advancers - decliners);
    const nonZeroReturns = rows.map((row) => row.dailyReturn).filter((value) => value !== 0);
    const avgDailyReturn = nonZeroReturns.length
      ? nonZeroReturns.reduce((sum, value) => sum + value, 0) / nonZeroReturns.length
      : 0;

    const topGainers = [...rows]
      .filter((row) => row.dailyReturn > 0)
      .sort((a, b) => b.dailyReturn - a.dailyReturn)
      .slice(0, 5);

    const topLosers = [...rows]
      .filter((row) => row.dailyReturn < 0)
      .sort((a, b) => a.dailyReturn - b.dailyReturn)
      .slice(0, 5);

    const liveFx = await getCachedUsdTryEurTry();
    const fx = mergeSnapshotFx(marketSnapshot?.usdTry, marketSnapshot?.eurTry, liveFx);

    return {
      summary: { avgDailyReturn, totalFundCount: fundCount },
      fundCount,
      totalPortfolioSize,
      totalInvestorCount,
      advancers,
      decliners,
      unchanged,
      lastSyncedAt: latest.updatedAt.toISOString(),
      snapshotDate: latest.date.toISOString(),
      usdTry: fx.usdTry,
      eurTry: fx.eurTry,
      topGainers,
      topLosers,
      formatted: {
        totalPortfolioSize: formatTL(totalPortfolioSize),
        totalInvestorCount: totalInvestorCount.toLocaleString("tr-TR"),
      },
    };
  } catch (error) {
    if (!isRelationMissingError(error)) throw error;

    const [
      fundCount,
      sums,
      nonZeroReturnAvg,
      advancers,
      decliners,
      snapshot,
      fundFreshness,
      topGainers,
      topLosers,
    ] = await Promise.all([
      prisma.fund.count({ where: { isActive: true } }),
      prisma.fund.aggregate({
        where: { isActive: true },
        _sum: { portfolioSize: true, investorCount: true },
      }),
      prisma.fund.aggregate({
        where: { isActive: true, dailyReturn: { not: 0 } },
        _avg: { dailyReturn: true },
      }),
      prisma.fund.count({ where: { isActive: true, dailyReturn: { gt: 0 } } }),
      prisma.fund.count({ where: { isActive: true, dailyReturn: { lt: 0 } } }),
      prisma.marketSnapshot.findFirst({ orderBy: { date: "desc" } }),
      prisma.fund.aggregate({
        where: { isActive: true },
        _max: { lastUpdatedAt: true },
      }),
      prisma.fund.findMany({
        where: { isActive: true, dailyReturn: { gt: 0 } },
        orderBy: { dailyReturn: "desc" },
        take: 5,
        select: {
          code: true,
          name: true,
          shortName: true,
          lastPrice: true,
          dailyReturn: true,
          portfolioSize: true,
        },
      }),
      prisma.fund.findMany({
        where: { isActive: true, dailyReturn: { lt: 0 } },
        orderBy: { dailyReturn: "asc" },
        take: 5,
        select: {
          code: true,
          name: true,
          shortName: true,
          lastPrice: true,
          dailyReturn: true,
          portfolioSize: true,
        },
      }),
    ]);

    const totalPortfolioSize = sums._sum.portfolioSize ?? 0;
    const totalInvestorCount = sums._sum.investorCount ?? 0;
    const unchanged = Math.max(0, fundCount - advancers - decliners);
    const avgDailyReturn = nonZeroReturnAvg._avg.dailyReturn ?? 0;

    const liveFx = await getCachedUsdTryEurTry();
    const fx = mergeSnapshotFx(snapshot?.usdTry, snapshot?.eurTry, liveFx);

    return {
      summary: { avgDailyReturn, totalFundCount: fundCount },
      totalPortfolioSize,
      totalInvestorCount,
      fundCount,
      advancers,
      decliners,
      unchanged,
      lastSyncedAt: fundFreshness._max.lastUpdatedAt?.toISOString() ?? null,
      snapshotDate: snapshot?.date?.toISOString() ?? null,
      usdTry: fx.usdTry,
      eurTry: fx.eurTry,
      topGainers,
      topLosers,
      formatted: {
        totalPortfolioSize: formatTL(totalPortfolioSize),
        totalInvestorCount: totalInvestorCount.toLocaleString("tr-TR"),
      },
    };
  }
}

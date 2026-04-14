import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import {
  buildExtendedNormalizationContext,
  calculateAllMetrics,
  calculateAlpha,
  calculateFinalScore,
  calculateNormalizedScoresExtended,
  compareRankedFunds,
  determineRiskLevel,
  NEUTRAL_SORT_SCORES,
  type FundMetrics,
  type FundScaleFields,
  type NormalizedScores,
  type PricePoint,
  type RankingMode,
  type RiskLevel,
} from "@/lib/scoring";
import { EMPTY_FUND_METRICS } from "@/lib/scoring/metrics";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import { fundTypeDisplayLabel, fundTypeForApi } from "@/lib/fund-type-display";
import { getCachedUsdTryEurTry, mergeSnapshotFx } from "@/lib/services/exchange-rates.service";
import type { ScoresApiPayload, ScoredFundRow } from "@/lib/services/fund-scores-types";
import { fetchSupabaseRestJson, hasSupabaseRestConfig } from "@/lib/supabase-rest";
import { classifyDailyReturnPctPoints2dp, countDailyReturnDirections } from "@/lib/daily-return-ui";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Günlük snapshot satırları: 3 yıl tutulur (eski günler silinir). */
const SNAPSHOT_RETENTION_DAYS = 1095;
const HISTORY_BATCH = 4000;
const SPARKLINE_POINTS = 7;
/** Metrik / skor için yüklenecek fiyat geçmişi: 3 yıl + küçük tampon. */
export const FUND_PRICE_HISTORY_LOOKBACK_DAYS = 1125;
const RETURN_LOOKBACK_DAYS = FUND_PRICE_HISTORY_LOOKBACK_DAYS;

function parseSnapshotMetrics(raw: Prisma.JsonValue): FundMetrics {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as unknown as FundMetrics;
  }
  return EMPTY_FUND_METRICS;
}

function parseSnapshotScores(raw: Prisma.JsonValue): NormalizedScores {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as unknown as NormalizedScores;
  }
  return NEUTRAL_SORT_SCORES;
}

function isRelationMissingError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

function topGainersAndLosersFromRows(
  rows: Array<{
    code: string;
    name: string;
    shortName: string | null;
    lastPrice: number;
    dailyReturn: number;
    portfolioSize: number;
  }>,
): {
  topGainers: MarketSnapshotSummaryPayload["topGainers"];
  topLosers: MarketSnapshotSummaryPayload["topLosers"];
} {
  const topGainers = rows
    .filter((r) => classifyDailyReturnPctPoints2dp(r.dailyReturn) === "positive")
    .sort((a, b) => b.dailyReturn - a.dailyReturn)
    .slice(0, 5);
  const topLosers = rows
    .filter((r) => classifyDailyReturnPctPoints2dp(r.dailyReturn) === "negative")
    .sort((a, b) => a.dailyReturn - b.dailyReturn)
    .slice(0, 5);
  return { topGainers, topLosers };
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

type SupabaseSnapshotDateRow = {
  date: string;
  updatedAt?: string;
};

type SupabaseCategoryRow = {
  id: string;
  code: string;
  name: string;
  color: string | null;
  description: string | null;
};

type SupabaseFundTypeRow = {
  id: string;
  code: number;
  name: string;
  description: string | null;
};

type SupabaseAggregateSnapshotRow = {
  categoryCode?: string | null;
  categoryName?: string | null;
  fundTypeCode?: number | null;
  fundTypeName?: string | null;
  dailyReturn: number;
  portfolioSize: number;
};

type SupabaseMarketSnapshotRow = {
  date: string;
  totalFundCount: number;
  totalPortfolioSize: number;
  totalInvestorCount: number;
  avgDailyReturn: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  usdTry: number | null;
  eurTry: number | null;
};

type SupabaseFundDailyRowForMarket = {
  code: string;
  name: string;
  shortName: string | null;
  lastPrice: number;
  dailyReturn: number;
  portfolioSize: number;
  investorCount: number | null;
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

export type FundTypeSnapshotSummary = {
  id: string;
  code: number;
  name: string;
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

const SNAPSHOT_SUMMARY_CACHE_SEC = 300;
export const MARKET_SUMMARY_CACHE_TAG = "market-summary";

export type FundHistoryPoint = {
  date: Date;
  price: number;
  portfolioSize: number;
  investorCount: number;
};

export type FundDailySnapshotRebuildStats = {
  written: number;
  scannedFunds: number;
  historyRowsRead: number;
  historyBatches: number;
  usedPreloadedHistory: boolean;
  usedPreloadedFunds: boolean;
};

export async function loadPriceHistoryByFundId(
  fundIds: string[],
  fromDate: Date
): Promise<Map<string, FundHistoryPoint[]>> {
  const map = new Map<string, FundHistoryPoint[]>();
  if (fundIds.length === 0) return map;

  for (let i = 0; i < fundIds.length; i += HISTORY_BATCH) {
    const chunk = fundIds.slice(i, i + HISTORY_BATCH);
    const rows = await prisma.fundPriceHistory.findMany({
      where: {
        fundId: { in: chunk },
        date: { gte: fromDate },
      },
      orderBy: [{ fundId: "asc" }, { date: "asc" }],
      select: { fundId: true, date: true, price: true, portfolioSize: true, investorCount: true },
    });

    for (const row of rows) {
      const arr = map.get(row.fundId) ?? [];
      arr.push({
        date: row.date,
        price: row.price,
        portfolioSize: row.portfolioSize,
        investorCount: row.investorCount,
      });
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

function buildSnapshotRecords(fundRows: FundRow[], historyByFund: Map<string, FundHistoryPoint[]>): SnapshotRecord[] {
  const computed = fundRows.map((fund) => {
    const historyRows = historyByFund.get(fund.id) ?? [];
    const performance = deriveFundPerformanceFromHistory(historyRows);
    const latestHistory = historyRows[historyRows.length - 1];
    const portfolioSize =
      latestHistory && Number.isFinite(latestHistory.portfolioSize) ? latestHistory.portfolioSize : fund.portfolioSize;
    const investorCount =
      latestHistory && Number.isFinite(latestHistory.investorCount) ? latestHistory.investorCount : fund.investorCount;
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

    return { fund, metrics, pricePoints, performance, portfolioSize, investorCount };
  });

  const scales: FundScaleFields[] = computed.map((item) => ({
    portfolioSize: item.portfolioSize,
    investorCount: item.investorCount,
    yearlyReturn: item.performance.yearlyReturn,
  }));
  const extCtx = buildExtendedNormalizationContext(
    computed.map((item) => item.metrics),
    scales
  );

  return computed.map(({ fund, metrics, performance }, i) => {
    const scores = calculateNormalizedScoresExtended(metrics, extCtx, scales[i]!);
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
      portfolioSize: computed[i]!.portfolioSize,
      investorCount: computed[i]!.investorCount,
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
  };
}

type FundMasterListSelect = {
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

/** Günlük özet satırı olmayan aktif fon: ana tabloda kalsın, skor null. */
function masterFundToScoredFundRow(fund: FundMasterListSelect): ScoredFundRow {
  return {
    fundId: fund.id,
    code: fund.code,
    name: fund.name,
    shortName: fund.shortName,
    logoUrl: getFundLogoUrlForUi(fund.id, fund.code, fund.logoUrl, fund.name),
    lastPrice: fund.lastPrice,
    dailyReturn: fund.dailyReturn,
    portfolioSize: fund.portfolioSize,
    investorCount: fund.investorCount,
    category: fund.category,
    fundType: fundTypeForApi(fund.fundType),
    finalScore: null,
  };
}

export async function rebuildFundDailySnapshots(
  snapshotDate: Date,
  options?: {
    preloadedFundRows?: FundRow[];
    preloadedHistoryByFund?: Map<string, FundHistoryPoint[]>;
  }
): Promise<FundDailySnapshotRebuildStats> {
  const fromDate = new Date(snapshotDate.getTime() - RETURN_LOOKBACK_DAYS * DAY_MS);
  const usedPreloadedFunds = Boolean(options?.preloadedFundRows);
  const fundRows = (options?.preloadedFundRows ??
    ((await prisma.fund.findMany({
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
    })) as FundRow[]));

  const usedPreloadedHistory = Boolean(options?.preloadedHistoryByFund);
  const historyByFund =
    options?.preloadedHistoryByFund ??
    (await loadPriceHistoryByFundId(
      fundRows.map((fund) => fund.id),
      fromDate
    ));
  const historyRowsRead = [...historyByFund.values()].reduce((sum, rows) => sum + rows.length, 0);
  const historyBatches = Math.ceil(Math.max(1, fundRows.length) / HISTORY_BATCH);

  const records = buildSnapshotRecords(fundRows, historyByFund);
  const retentionCutoff = new Date(snapshotDate.getTime() - SNAPSHOT_RETENTION_DAYS * DAY_MS);

  await prisma.$transaction(
    async (tx) => {
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
    },
    {
      maxWait: 15_000,
      timeout: 120_000,
    }
  );

  return {
    written: records.length,
    scannedFunds: fundRows.length,
    historyRowsRead,
    historyBatches,
    usedPreloadedHistory,
    usedPreloadedFunds,
  };
}

export async function getScoresPayloadFromDailySnapshot(
  mode: RankingMode,
  categoryKey: string,
  options?: { limit?: number; includeTotal?: boolean }
): Promise<ScoresApiPayload | null> {
  const startedAt = Date.now();
  const normalizedCategory = categoryKey.trim();
  const requestedLimit = Number.isFinite(options?.limit)
    ? Math.max(1, Math.trunc(options?.limit as number))
    : null;
  const limit = requestedLimit ? Math.min(requestedLimit, 2500) : null;
  const includeTotal = options?.includeTotal !== false;

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

  const orderBy = (
    mode === "LOW_RISK"
      ? [{ finalScoreLowRisk: "desc" as const }, { code: "asc" as const }]
      : mode === "HIGH_RETURN"
        ? [{ finalScoreHighReturn: "desc" as const }, { code: "asc" as const }]
        : mode === "STABLE"
          ? [{ finalScoreStable: "desc" as const }, { code: "asc" as const }]
          : [{ finalScoreBest: "desc" as const }, { code: "asc" as const }]
  ) satisfies Prisma.FundDailySnapshotOrderByWithRelationInput[];

  const where = {
    date: latest.date,
    ...(normalizedCategory ? { categoryCode: normalizedCategory } : {}),
  } satisfies Prisma.FundDailySnapshotWhereInput;

  const select = {
    fundId: true,
    code: true,
    name: true,
    shortName: true,
    logoUrl: true,
    lastPrice: true,
    dailyReturn: true,
    portfolioSize: true,
    investorCount: true,
    categoryCode: true,
    categoryName: true,
    fundTypeCode: true,
    fundTypeName: true,
    finalScoreBest: true,
    finalScoreLowRisk: true,
    finalScoreHighReturn: true,
    finalScoreStable: true,
  } satisfies Prisma.FundDailySnapshotSelect;

  const shouldCount = includeTotal && limit != null;
  const queryStartedAt = Date.now();
  let rows: Array<Prisma.FundDailySnapshotGetPayload<{ select: typeof select }>> = [];
  let totalCount: number | null = null;
  try {
    const [fetchedRows, fetchedCount] = await Promise.all([
      prisma.fundDailySnapshot.findMany({
        where,
        orderBy,
        ...(limit ? { take: limit } : {}),
        select,
      }),
      shouldCount ? prisma.fundDailySnapshot.count({ where }) : Promise.resolve(null),
    ]);
    rows = fetchedRows;
    totalCount = fetchedCount;
  } catch (error) {
    if (isRelationMissingError(error)) return null;
    throw error;
  }
  const scoreKey = scoreField(mode);
  const funds: ScoredFundRow[] = rows.map((row) => ({
    fundId: row.fundId,
    code: row.code,
    name: row.name,
    shortName: row.shortName,
    logoUrl: getFundLogoUrlForUi(row.fundId, row.code, row.logoUrl, row.name),
    lastPrice: row.lastPrice,
    dailyReturn: row.dailyReturn,
    portfolioSize: row.portfolioSize,
    investorCount: row.investorCount,
    category: row.categoryCode && row.categoryName ? { code: row.categoryCode, name: row.categoryName } : null,
    fundType:
      row.fundTypeCode != null && row.fundTypeName
        ? fundTypeForApi({ code: row.fundTypeCode, name: row.fundTypeName })
        : null,
    finalScore: row[scoreKey],
  }));

  const queryDurationMs = Date.now() - queryStartedAt;
  const total = totalCount ?? funds.length;
  const totalDurationMs = Date.now() - startedAt;
  console.info(
    `[scores-db] mode=${mode} category=${normalizedCategory || "all"} rows=${funds.length} total=${total} ` +
      `queryMs=${queryDurationMs} totalMs=${totalDurationMs} limit=${limit ?? "none"}`
  );

  return { mode, total, funds };
}

async function computeCategorySummariesFromDailySnapshot(): Promise<CategorySnapshotSummary[]> {
  try {
    const latest = await prisma.fundDailySnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    });
    if (!latest) return [];

    const [categories, grouped] = await Promise.all([
      prisma.fundCategory.findMany({ orderBy: { name: "asc" } }),
      prisma.fundDailySnapshot.groupBy({
        by: ["categoryCode"],
        where: { date: latest.date },
        _count: { _all: true },
        _avg: { dailyReturn: true },
        _sum: { portfolioSize: true },
      }),
    ]);

    const stats = new Map(
      grouped
        .filter((row): row is typeof row & { categoryCode: string } => typeof row.categoryCode === "string" && row.categoryCode.length > 0)
        .map((row) => [
          row.categoryCode,
          {
            fundCount: row._count._all,
            avgDailyReturn: Number((row._avg.dailyReturn ?? 0).toFixed(4)),
            totalPortfolioSize: row._sum.portfolioSize ?? 0,
          },
        ])
    );

    return categories.map((category) => {
      const current = stats.get(category.code);
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

async function computeCategorySummariesFromSupabaseRest(): Promise<CategorySnapshotSummary[]> {
  if (!hasSupabaseRestConfig()) throw new Error("supabase_rest_not_configured");

  const [categories, latestRows] = await Promise.all([
    fetchSupabaseRestJson<SupabaseCategoryRow[]>(
      "FundCategory?select=id,code,name,color,description&order=name.asc",
      { revalidate: SNAPSHOT_SUMMARY_CACHE_SEC }
    ),
    fetchSupabaseRestJson<SupabaseSnapshotDateRow[]>(
      "FundDailySnapshot?select=date&order=date.desc&limit=1",
      { revalidate: SNAPSHOT_SUMMARY_CACHE_SEC }
    ),
  ]);
  const latestDate = latestRows[0]?.date;
  if (!latestDate) {
    return categories.map((category) => ({
      id: category.id,
      code: category.code,
      name: category.name,
      color: category.color,
      description: category.description,
      fundCount: 0,
      avgDailyReturn: 0,
      totalPortfolioSize: 0,
    }));
  }

  const rows = await fetchSupabaseRestJson<SupabaseAggregateSnapshotRow[]>(
    `FundDailySnapshot?select=categoryCode,categoryName,dailyReturn,portfolioSize&date=eq.${latestDate}&limit=3000`,
    { revalidate: SNAPSHOT_SUMMARY_CACHE_SEC }
  );

  const stats = new Map<string, { fundCount: number; dailyReturnTotal: number; totalPortfolioSize: number }>();
  for (const row of rows) {
    if (!row.categoryCode) continue;
    const current = stats.get(row.categoryCode) ?? { fundCount: 0, dailyReturnTotal: 0, totalPortfolioSize: 0 };
    current.fundCount += 1;
    current.dailyReturnTotal += row.dailyReturn ?? 0;
    current.totalPortfolioSize += row.portfolioSize ?? 0;
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
      avgDailyReturn: current && current.fundCount > 0 ? Number((current.dailyReturnTotal / current.fundCount).toFixed(4)) : 0,
      totalPortfolioSize: current?.totalPortfolioSize ?? 0,
    };
  });
}

export async function getCategorySummariesFromDailySnapshot(): Promise<CategorySnapshotSummary[]> {
  const loadCached = unstable_cache(
    async () => computeCategorySummariesFromDailySnapshot(),
    ["fund-daily-snapshot-category-summaries-v3"],
    { revalidate: SNAPSHOT_SUMMARY_CACHE_SEC }
  );
  return loadCached();
}

export async function getCategorySummariesFromDailySnapshotSafe(): Promise<CategorySnapshotSummary[]> {
  try {
    return await getCategorySummariesFromDailySnapshot();
  } catch (error) {
    console.error("[fund-daily-snapshot] category summaries failed", error);
    return [];
  }
}

async function computeFundTypeSummariesFromDailySnapshot(): Promise<FundTypeSnapshotSummary[]> {
  try {
    const latest = await prisma.fundDailySnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    });
    if (!latest) return [];

    const [fundTypes, grouped] = await Promise.all([
      prisma.fundType.findMany({
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, description: true },
      }),
      prisma.fundDailySnapshot.groupBy({
        by: ["fundTypeCode"],
        where: { date: latest.date },
        _count: { _all: true },
        _avg: { dailyReturn: true },
        _sum: { portfolioSize: true },
      }),
    ]);

    const stats = new Map(
      grouped
        .filter((row): row is typeof row & { fundTypeCode: number } => row.fundTypeCode != null)
        .map((row) => [
          row.fundTypeCode,
          {
            fundCount: row._count._all,
            avgDailyReturn: Number((row._avg.dailyReturn ?? 0).toFixed(4)),
            totalPortfolioSize: row._sum.portfolioSize ?? 0,
          },
        ])
    );

    return fundTypes.map((fundType) => {
      const current = stats.get(fundType.code);
      return {
        id: fundType.id,
        code: fundType.code,
        name: fundTypeDisplayLabel(fundType),
        description: fundType.description,
        fundCount: current?.fundCount ?? 0,
        avgDailyReturn: current?.avgDailyReturn ?? 0,
        totalPortfolioSize: current?.totalPortfolioSize ?? 0,
      };
    });
  } catch (error) {
    if (!isRelationMissingError(error)) throw error;

    const [fundTypes, byType] = await Promise.all([
      prisma.fundType.findMany({
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, description: true },
      }),
      prisma.fund.groupBy({
        by: ["fundTypeId"],
        where: { isActive: true },
        _count: { _all: true },
        _avg: { dailyReturn: true },
        _sum: { portfolioSize: true },
      }),
    ]);

    const stats = new Map(
      byType
        .filter((row): row is typeof row & { fundTypeId: string } => row.fundTypeId != null)
        .map((row) => [
          row.fundTypeId,
          {
            fundCount: row._count._all,
            avgDailyReturn: Number((row._avg.dailyReturn ?? 0).toFixed(4)),
            totalPortfolioSize: row._sum.portfolioSize ?? 0,
          },
        ])
    );

    return fundTypes.map((fundType) => {
      const current = stats.get(fundType.id);
      return {
        id: fundType.id,
        code: fundType.code,
        name: fundTypeDisplayLabel(fundType),
        description: fundType.description,
        fundCount: current?.fundCount ?? 0,
        avgDailyReturn: current?.avgDailyReturn ?? 0,
        totalPortfolioSize: current?.totalPortfolioSize ?? 0,
      };
    });
  }
}

async function computeFundTypeSummariesFromSupabaseRest(): Promise<FundTypeSnapshotSummary[]> {
  if (!hasSupabaseRestConfig()) throw new Error("supabase_rest_not_configured");

  const [fundTypes, latestRows] = await Promise.all([
    fetchSupabaseRestJson<SupabaseFundTypeRow[]>(
      "FundType?select=id,code,name,description&order=code.asc",
      { revalidate: SNAPSHOT_SUMMARY_CACHE_SEC }
    ),
    fetchSupabaseRestJson<SupabaseSnapshotDateRow[]>(
      "FundDailySnapshot?select=date&order=date.desc&limit=1",
      { revalidate: SNAPSHOT_SUMMARY_CACHE_SEC }
    ),
  ]);
  const latestDate = latestRows[0]?.date;
  if (!latestDate) {
    return fundTypes.map((fundType) => ({
      id: fundType.id,
      code: fundType.code,
      name: fundTypeDisplayLabel(fundType),
      description: fundType.description,
      fundCount: 0,
      avgDailyReturn: 0,
      totalPortfolioSize: 0,
    }));
  }

  const rows = await fetchSupabaseRestJson<SupabaseAggregateSnapshotRow[]>(
    `FundDailySnapshot?select=fundTypeCode,fundTypeName,dailyReturn,portfolioSize&date=eq.${latestDate}&limit=3000`,
    { revalidate: SNAPSHOT_SUMMARY_CACHE_SEC }
  );

  const stats = new Map<number, { fundCount: number; dailyReturnTotal: number; totalPortfolioSize: number }>();
  for (const row of rows) {
    if (row.fundTypeCode == null) continue;
    const current = stats.get(row.fundTypeCode) ?? { fundCount: 0, dailyReturnTotal: 0, totalPortfolioSize: 0 };
    current.fundCount += 1;
    current.dailyReturnTotal += row.dailyReturn ?? 0;
    current.totalPortfolioSize += row.portfolioSize ?? 0;
    stats.set(row.fundTypeCode, current);
  }

  return fundTypes.map((fundType) => {
    const current = stats.get(fundType.code);
    return {
      id: fundType.id,
      code: fundType.code,
      name: fundTypeDisplayLabel(fundType),
      description: fundType.description,
      fundCount: current?.fundCount ?? 0,
      avgDailyReturn: current && current.fundCount > 0 ? Number((current.dailyReturnTotal / current.fundCount).toFixed(4)) : 0,
      totalPortfolioSize: current?.totalPortfolioSize ?? 0,
    };
  });
}

export async function getFundTypeSummariesFromDailySnapshot(): Promise<FundTypeSnapshotSummary[]> {
  const loadCached = unstable_cache(
    async () => {
      if (hasSupabaseRestConfig()) {
        try {
          return await computeFundTypeSummariesFromSupabaseRest();
        } catch (error) {
          console.error("[fund-daily-snapshot] supabase-rest fund type summaries failed", error);
        }
      }
      return computeFundTypeSummariesFromDailySnapshot();
    },
    ["fund-daily-snapshot-fund-type-summaries-v3"],
    { revalidate: SNAPSHOT_SUMMARY_CACHE_SEC }
  );
  return loadCached();
}

export async function getFundTypeSummariesFromDailySnapshotSafe(): Promise<FundTypeSnapshotSummary[]> {
  try {
    return await getFundTypeSummariesFromDailySnapshot();
  } catch (error) {
    console.error("[fund-daily-snapshot] fund type summaries failed", error);
    return [];
  }
}

async function computeMarketSummaryFromDailySnapshot(): Promise<MarketSnapshotSummaryPayload | null> {
  try {
    const latest = await prisma.fundDailySnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true, updatedAt: true },
    });
    if (!latest) return null;

    const [marketSnapshot, allForDate] = await Promise.all([
      prisma.marketSnapshot.findUnique({
        where: { date: latest.date },
      }),
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
    ]);

    const summary = marketSnapshot ?? {
      totalFundCount: 0,
      totalPortfolioSize: 0,
      totalInvestorCount: 0,
      avgDailyReturn: 0,
      advancers: 0,
      decliners: 0,
      unchanged: 0,
      usdTry: null,
      eurTry: null,
    };
    const fallbackFundCount = allForDate.length;
    const fallbackTotalPortfolioSize = allForDate.reduce((sum, row) => sum + Number(row.portfolioSize || 0), 0);
    const fallbackTotalInvestorCount = allForDate.reduce((sum, row) => {
      const value = Number((row as { investorCount?: number | null }).investorCount ?? 0);
      return sum + (Number.isFinite(value) && value > 0 ? value : 0);
    }, 0);
    const fallbackAvgDailyReturn = (() => {
      const returns = allForDate
        .map((row) => Number(row.dailyReturn))
        .filter((value) => Number.isFinite(value) && classifyDailyReturnPctPoints2dp(value) !== "neutral");
      if (returns.length === 0) return 0;
      return returns.reduce((acc, value) => acc + value, 0) / returns.length;
    })();
    const fallbackInvestorFromFundTable = fallbackTotalInvestorCount > 0
      ? fallbackTotalInvestorCount
      : await prisma.fund
          .aggregate({
            where: { isActive: true },
            _sum: { investorCount: true },
          })
          .then((agg) => agg._sum.investorCount ?? 0)
          .catch(() => 0);
    const marketSnapshotValid =
      summary.totalFundCount > 0 &&
      summary.totalPortfolioSize > 0 &&
      summary.totalInvestorCount > 0 &&
      Number.isFinite(summary.avgDailyReturn);
    const effectiveFundCount = marketSnapshotValid ? summary.totalFundCount : fallbackFundCount;
    const effectiveTotalPortfolioSize = marketSnapshotValid ? summary.totalPortfolioSize : fallbackTotalPortfolioSize;
    const effectiveTotalInvestorCount = marketSnapshotValid
      ? summary.totalInvestorCount
      : fallbackInvestorFromFundTable;
    const effectiveAvgDailyReturn = marketSnapshotValid ? summary.avgDailyReturn : fallbackAvgDailyReturn;
    const directionCounts = countDailyReturnDirections(allForDate.map((r) => r.dailyReturn));
    const { topGainers, topLosers } = topGainersAndLosersFromRows(allForDate);
    const liveFx = await getCachedUsdTryEurTry();
    const fx = mergeSnapshotFx(marketSnapshot?.usdTry, marketSnapshot?.eurTry, liveFx);
    console.info(
      `[market-summary-source] source=daily_snapshot market_snapshot_valid=${marketSnapshotValid ? 1 : 0} ` +
        `market_snapshot_present=${marketSnapshot ? 1 : 0} fallback_rows=${fallbackFundCount} ` +
        `effective_fund_count=${effectiveFundCount} effective_portfolio=${Math.round(effectiveTotalPortfolioSize)} ` +
        `effective_investor=${Math.round(effectiveTotalInvestorCount)}`
    );

    return {
      summary: {
        avgDailyReturn: effectiveAvgDailyReturn,
        totalFundCount: effectiveFundCount,
      },
      fundCount: effectiveFundCount,
      totalPortfolioSize: effectiveTotalPortfolioSize,
      totalInvestorCount: effectiveTotalInvestorCount,
      advancers: directionCounts.advancers,
      decliners: directionCounts.decliners,
      unchanged: directionCounts.unchanged,
      lastSyncedAt: latest.updatedAt.toISOString(),
      snapshotDate: latest.date.toISOString(),
      usdTry: fx.usdTry,
      eurTry: fx.eurTry,
      topGainers,
      topLosers,
      formatted: {
        totalPortfolioSize: formatTL(effectiveTotalPortfolioSize),
        totalInvestorCount: effectiveTotalInvestorCount.toLocaleString("tr-TR"),
      },
    };
  } catch (error) {
    if (!isRelationMissingError(error)) throw error;

    const [sums, snapshot, fundFreshness, activeFunds] = await Promise.all([
      prisma.fund.aggregate({
        where: { isActive: true },
        _sum: { portfolioSize: true, investorCount: true },
      }),
      prisma.marketSnapshot.findFirst({ orderBy: { date: "desc" } }),
      prisma.fund.aggregate({
        where: { isActive: true },
        _max: { lastUpdatedAt: true },
      }),
      prisma.fund.findMany({
        where: { isActive: true },
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

    const fundCount = activeFunds.length;
    const directionCounts = countDailyReturnDirections(activeFunds.map((f) => f.dailyReturn));
    const { topGainers, topLosers } = topGainersAndLosersFromRows(activeFunds);
    const rets = activeFunds
      .map((f) => f.dailyReturn)
      .filter((d) => classifyDailyReturnPctPoints2dp(d) !== "neutral");
    const avgDailyReturn = rets.length > 0 ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;

    const totalPortfolioSize = sums._sum.portfolioSize ?? 0;
    const totalInvestorCount = sums._sum.investorCount ?? 0;

    const liveFx = await getCachedUsdTryEurTry();
    const fx = mergeSnapshotFx(snapshot?.usdTry, snapshot?.eurTry, liveFx);

    return {
      summary: { avgDailyReturn, totalFundCount: fundCount },
      totalPortfolioSize,
      totalInvestorCount,
      fundCount,
      advancers: directionCounts.advancers,
      decliners: directionCounts.decliners,
      unchanged: directionCounts.unchanged,
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

async function computeMarketSummaryFromSupabaseRest(): Promise<MarketSnapshotSummaryPayload | null> {
  if (!hasSupabaseRestConfig()) throw new Error("supabase_rest_not_configured");

  const latestRows = await fetchSupabaseRestJson<SupabaseSnapshotDateRow[]>(
    "FundDailySnapshot?select=date,updatedAt&order=date.desc,updatedAt.desc&limit=1",
    { revalidate: SNAPSHOT_SUMMARY_CACHE_SEC }
  );
  const latest = latestRows[0];
  if (!latest?.date) return null;

  const [marketSnapshots, allForDate] = await Promise.all([
    fetchSupabaseRestJson<SupabaseMarketSnapshotRow[]>(
      `MarketSnapshot?select=date,totalFundCount,totalPortfolioSize,totalInvestorCount,avgDailyReturn,advancers,decliners,unchanged,usdTry,eurTry&date=eq.${latest.date}&limit=1`,
      { revalidate: SNAPSHOT_SUMMARY_CACHE_SEC }
    ),
    fetchSupabaseRestJson<SupabaseFundDailyRowForMarket[]>(
      `FundDailySnapshot?select=code,name,shortName,lastPrice,dailyReturn,portfolioSize,investorCount&date=eq.${latest.date}&limit=6000`,
      { revalidate: SNAPSHOT_SUMMARY_CACHE_SEC }
    ),
  ]);

  const summary = marketSnapshots[0] ?? {
    date: latest.date,
    totalFundCount: 0,
    totalPortfolioSize: 0,
    totalInvestorCount: 0,
    avgDailyReturn: 0,
    advancers: 0,
    decliners: 0,
    unchanged: 0,
    usdTry: null,
    eurTry: null,
  };
  const fallbackFundCount = allForDate.length;
  const fallbackTotalPortfolioSize = allForDate.reduce((sum, row) => sum + Number(row.portfolioSize || 0), 0);
  const fallbackTotalInvestorCount = allForDate.reduce((sum, row) => {
    const value = Number(row.investorCount ?? 0);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  const fallbackInvestorFromFundTable = fallbackTotalInvestorCount > 0
    ? fallbackTotalInvestorCount
    : await prisma.fund
        .aggregate({
          where: { isActive: true },
          _sum: { investorCount: true },
        })
        .then((agg) => agg._sum.investorCount ?? 0)
        .catch(() => 0);
  const effectiveFundCount = summary.totalFundCount > 0 ? summary.totalFundCount : fallbackFundCount;
  const effectiveTotalPortfolioSize =
    summary.totalPortfolioSize > 0 ? summary.totalPortfolioSize : fallbackTotalPortfolioSize;
  const effectiveTotalInvestorCount =
    summary.totalInvestorCount > 0 ? summary.totalInvestorCount : fallbackInvestorFromFundTable;
  const liveFx = await getCachedUsdTryEurTry();
  const fx = mergeSnapshotFx(summary.usdTry, summary.eurTry, liveFx);

  const directionCounts = countDailyReturnDirections(allForDate.map((r) => Number(r.dailyReturn)));
  const { topGainers, topLosers } = topGainersAndLosersFromRows(
    allForDate.map((r) => ({
      ...r,
      dailyReturn: Number(r.dailyReturn),
      lastPrice: Number(r.lastPrice),
      portfolioSize: Number(r.portfolioSize),
    })),
  );

  return {
    summary: {
      avgDailyReturn: summary.avgDailyReturn,
      totalFundCount: effectiveFundCount,
    },
    fundCount: effectiveFundCount,
    totalPortfolioSize: effectiveTotalPortfolioSize,
    totalInvestorCount: effectiveTotalInvestorCount,
    advancers: directionCounts.advancers,
    decliners: directionCounts.decliners,
    unchanged: directionCounts.unchanged,
    lastSyncedAt: latest.updatedAt ?? latest.date,
    snapshotDate: latest.date,
    usdTry: fx.usdTry,
    eurTry: fx.eurTry,
    topGainers,
    topLosers,
    formatted: {
      totalPortfolioSize: formatTL(effectiveTotalPortfolioSize),
      totalInvestorCount: effectiveTotalInvestorCount.toLocaleString("tr-TR"),
    },
  };
}

export async function getMarketSummaryFromDailySnapshot(): Promise<MarketSnapshotSummaryPayload | null> {
  const loadCached = unstable_cache(
    async () => computeMarketSummaryFromDailySnapshot(),
    ["fund-daily-snapshot-market-summary-v5"],
    {
      revalidate: SNAPSHOT_SUMMARY_CACHE_SEC,
      tags: [MARKET_SUMMARY_CACHE_TAG],
    }
  );
  return loadCached();
}

export async function getMarketSummaryFromDailySnapshotSafe(): Promise<MarketSnapshotSummaryPayload | null> {
  try {
    return await getMarketSummaryFromDailySnapshot();
  } catch (error) {
    console.error("[fund-daily-snapshot] market summary failed", error);
    return null;
  }
}

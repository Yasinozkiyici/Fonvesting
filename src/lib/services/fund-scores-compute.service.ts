import { prisma } from "@/lib/prisma";
import { deriveFundPerformanceFromHistory } from "@/lib/services/fund-daily-snapshot.service";
import {
  calculateAllMetrics,
  buildExtendedNormalizationContext,
  calculateNormalizedScoresExtended,
  calculateFinalScore,
  compareRankedFunds,
  type FundMetrics,
  type FundScaleFields,
  type RankingMode,
  type PricePoint,
} from "@/lib/scoring";
import { getScoresPayloadFromDailySnapshot } from "@/lib/services/fund-daily-snapshot.service";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import { fundTypeForApi } from "@/lib/fund-type-display";
import { getScoresPayloadFromDerivedMetrics } from "@/lib/services/fund-derived-metrics.service";
import type { ScoredFundRow, ScoresApiPayload } from "@/lib/services/fund-scores-types";

export type { ScoredFundRow, ScoresApiPayload } from "@/lib/services/fund-scores-types";

interface FundRow {
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
  categoryId: string | null;
  category: { code: string; name: string } | null;
  fundType: { code: number; name: string } | null;
}

interface FundWithHistory extends FundRow {
  priceHistory: Array<{ date: Date; price: number }>;
}

const HISTORY_BATCH = 4000;

async function loadPriceHistoryByFundId(
  fundIds: string[],
  thirtyDaysAgo: Date
): Promise<Map<string, Array<{ date: Date; price: number }>>> {
  const map = new Map<string, Array<{ date: Date; price: number }>>();
  if (fundIds.length === 0) return map;

  for (let i = 0; i < fundIds.length; i += HISTORY_BATCH) {
    const chunk = fundIds.slice(i, i + HISTORY_BATCH);
    const rows = await prisma.fundPriceHistory.findMany({
      where: {
        fundId: { in: chunk },
        date: { gte: thirtyDaysAgo },
      },
      orderBy: [{ fundId: "asc" }, { date: "asc" }],
      select: { fundId: true, date: true, price: true },
    });
    for (const h of rows) {
      const arr = map.get(h.fundId) ?? [];
      arr.push({ date: h.date, price: h.price });
      map.set(h.fundId, arr);
    }
  }
  return map;
}

/**
 * Tüm fon skorlarını hesaplar (ağır). Günlük job veya cache miss’te çağrılmalı;
 * kullanıcı isteğinde tercihen DB’deki ScoresApiCache okunur.
 */
async function computeScoresPayloadFromRawData(mode: RankingMode, categoryKey: string): Promise<ScoresApiPayload> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const whereClause: Record<string, unknown> = { isActive: true };
  if (categoryKey) {
    whereClause.category = { code: categoryKey };
  }

  const fundRows = (await prisma.fund.findMany({
    where: whereClause,
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
      categoryId: true,
      category: { select: { code: true, name: true } },
      fundType: { select: { code: true, name: true } },
    },
    orderBy: { portfolioSize: "desc" },
  })) as FundRow[];

  const historyByFund = await loadPriceHistoryByFundId(
    fundRows.map((f) => f.id),
    thirtyDaysAgo
  );

  const funds: FundWithHistory[] = fundRows.map((f) => ({
    ...f,
    priceHistory: historyByFund.get(f.id) ?? [],
  }));

  const fundsWithMetrics: Array<{
    fund: FundWithHistory;
    metrics: FundMetrics;
    pricePoints: PricePoint[];
    performance: ReturnType<typeof deriveFundPerformanceFromHistory>;
  }> = [];

  for (const fund of funds) {
    const performance = deriveFundPerformanceFromHistory(fund.priceHistory);
    const pricePoints: PricePoint[] = performance.pricePoints.map((point) => ({
      date: point.date,
      price: point.price,
    }));

    if (pricePoints.length === 0 && fund.lastPrice > 0) {
      const now = new Date();
      pricePoints.push({ date: now, price: fund.lastPrice });
    }

    const metrics = calculateAllMetrics(pricePoints);

    if (metrics.dataPoints < 2 && performance.dailyReturn !== 0) {
      metrics.annualizedReturn = performance.dailyReturn * 252;
      metrics.totalReturn = performance.dailyReturn;
    }

    fundsWithMetrics.push({ fund, metrics, pricePoints, performance });
  }

  const allMetrics = fundsWithMetrics.map((f) => f.metrics);
  const scales: FundScaleFields[] = fundsWithMetrics.map(({ fund, performance }) => ({
    portfolioSize: fund.portfolioSize,
    investorCount: fund.investorCount,
    yearlyReturn: performance.yearlyReturn,
  }));
  const extCtx = buildExtendedNormalizationContext(allMetrics, scales);

  const scoredFunds = fundsWithMetrics.map(({ fund, metrics, performance }, i) => {
    const scores = calculateNormalizedScoresExtended(metrics, extCtx, scales[i]!);
    const finalScore = calculateFinalScore(scores, mode);

    return {
      item: {
        fundId: fund.id,
        code: fund.code,
        name: fund.name,
        shortName: fund.shortName,
        logoUrl: getFundLogoUrlForUi(fund.id, fund.code, fund.logoUrl, fund.name),
        lastPrice: performance.lastPrice || fund.lastPrice,
        dailyReturn: performance.dailyReturn,
        portfolioSize: fund.portfolioSize,
        investorCount: fund.investorCount,
        category: fund.category,
        fundType: fundTypeForApi(fund.fundType),
        finalScore,
      } satisfies ScoredFundRow,
      scores,
      yearlyReturn: performance.yearlyReturn,
      monthlyReturn: performance.monthlyReturn,
      metrics,
    };
  });

  scoredFunds.sort((a, b) =>
    compareRankedFunds(mode, {
      code: a.item.code,
      finalScore: a.item.finalScore,
      scores: a.scores,
      yearlyReturn: a.yearlyReturn,
      monthlyReturn: a.monthlyReturn,
      metrics: a.metrics,
      trailingReturnBlend: null,
    }, {
      code: b.item.code,
      finalScore: b.item.finalScore,
      scores: b.scores,
      yearlyReturn: b.yearlyReturn,
      monthlyReturn: b.monthlyReturn,
      metrics: b.metrics,
      trailingReturnBlend: null,
    })
  );

  return {
    mode,
    total: scoredFunds.length,
    funds: scoredFunds.map((entry) => entry.item),
  };
}

export async function computeScoresPayload(
  mode: RankingMode,
  categoryKey: string,
  queryTrim = ""
): Promise<ScoresApiPayload> {
  const snapshotPayload = await getScoresPayloadFromDailySnapshot(mode, categoryKey);
  if (snapshotPayload) {
    return queryTrim ? filterScoresPayloadByQuery(snapshotPayload, queryTrim) : snapshotPayload;
  }
  const derivedPayload = await getScoresPayloadFromDerivedMetrics(mode, categoryKey, queryTrim);
  if (derivedPayload) return derivedPayload;
  const raw = await computeScoresPayloadFromRawData(mode, categoryKey);
  return queryTrim ? filterScoresPayloadByQuery(raw, queryTrim) : raw;
}

export function filterScoresPayloadByQuery(payload: ScoresApiPayload, q: string): ScoresApiPayload {
  const needle = q.trim().toLowerCase();
  if (!needle) return { ...payload, appliedQuery: undefined };
  const funds = payload.funds.filter(
    (f) => f.code.toLowerCase().includes(needle) || f.name.toLowerCase().includes(needle)
  );
  return { ...payload, total: funds.length, funds, appliedQuery: q.trim() };
}

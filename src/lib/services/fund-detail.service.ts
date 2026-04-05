import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import {
  calculateAllMetrics,
  determineRiskLevel,
  getBenchmarkForCategory,
  getBenchmarkName,
  type FundMetrics,
  type PricePoint,
  type RiskLevel,
} from "@/lib/scoring";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import { fundTypeDisplayLabel } from "@/lib/fund-type-display";
import { inferPortfolioManagerFromFundName } from "@/lib/fund-infer-manager";

const HISTORY_CAP = 2500;
const DAY_MS = 86400000;
const ROLLING_TRADING_DAYS = 21;

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

const RISK_LEVELS: RiskLevel[] = ["very_low", "low", "medium", "high", "very_high"];

function parseRiskLevel(raw: string | null | undefined): RiskLevel | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim() as RiskLevel;
  return RISK_LEVELS.includes(s) ? s : null;
}

function parseFundMetricsJson(value: unknown): FundMetrics | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k] as number) ? (o[k] as number) : null);
  if (n("volatility") == null && n("maxDrawdown") == null) return null;
  return {
    totalReturn: n("totalReturn") ?? 0,
    annualizedReturn: n("annualizedReturn") ?? 0,
    volatility: n("volatility") ?? 0,
    maxDrawdown: n("maxDrawdown") ?? 0,
    sharpeRatio: n("sharpeRatio") ?? 0,
    sortinoRatio: n("sortinoRatio") ?? 0,
    calmarRatio: n("calmarRatio") ?? 0,
    winRate: n("winRate") ?? 0,
    avgGain: n("avgGain") ?? 0,
    avgLoss: n("avgLoss") ?? 0,
    dataPoints: Math.round(n("dataPoints") ?? 0),
  };
}

export type FundDetailPricePoint = { t: number; p: number };

export type FundDetailSimilarFund = {
  code: string;
  name: string;
  shortName: string | null;
  lastPrice: number;
  dailyReturn: number;
  logoUrl: string | null;
};

/** Fiyat geçmişinden türetilen özetler (risk bölümü). */
export type FundDetailDerivedSummary = {
  /** Son gözlemden geriye ~365 gün veya mevcut seri başı. */
  returnApprox1YearPct: number | null;
  /** Son gözlemden geriye ~730 gün veya mevcut seri başı. */
  returnApprox2YearPct: number | null;
  /** Ardışık ~21 işlem günü pencereleri içinde en yüksek birikimli getiri (%). */
  bestRollingMonthPct: number | null;
  /** Aynı tanım için en düşük birikimli getiri (%). */
  worstRollingMonthPct: number | null;
};

export type FundDetailPageData = {
  fund: {
    code: string;
    name: string;
    shortName: string | null;
    description: string | null;
    lastPrice: number;
    dailyReturn: number;
    weeklyReturn: number;
    monthlyReturn: number;
    yearlyReturn: number;
    portfolioSize: number;
    investorCount: number;
    category: { code: string; name: string } | null;
    fundType: { code: number; name: string } | null;
    logoUrl: string | null;
    lastUpdatedAt: string | null;
    updatedAt: string;
    portfolioManagerInferred: string | null;
  };
  snapshotDate: string | null;
  snapshotAlpha: number | null;
  riskLevel: RiskLevel | null;
  snapshotMetrics: FundMetrics | null;
  priceSeries: FundDetailPricePoint[];
  historyMetrics: FundMetrics | null;
  bestWorstDay: { bestPct: number; worstPct: number } | null;
  /** Skorlama modelindeki kategori referans kodu; resmi fon benchmark’ı değildir. */
  modelBenchmark: { code: string; label: string } | null;
  /** TEFAS yurt içi fonları için standart işlem birimi. */
  tradingCurrency: "TRY";
  derivedSummary: FundDetailDerivedSummary;
  similarFunds: FundDetailSimilarFund[];
};

function bestWorstDailyReturn(
  rows: Array<{ dailyReturn: number }>
): { bestPct: number; worstPct: number } | null {
  let best = -Infinity;
  let worst = Infinity;
  for (const r of rows) {
    const v = r.dailyReturn;
    if (!Number.isFinite(v) || v === 0) continue;
    if (v > best) best = v;
    if (v < worst) worst = v;
  }
  if (!Number.isFinite(best) || !Number.isFinite(worst)) return null;
  return { bestPct: best, worstPct: worst };
}

function returnApproxCalendarDays(points: PricePoint[], days: number): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  const cutoff = last.date.getTime() - days * DAY_MS;
  let start: PricePoint | null = null;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i]!;
    if (p.date.getTime() <= cutoff) {
      start = p;
      break;
    }
  }
  if (!start) start = points[0]!;
  if (start.price <= 0 || last.price <= 0) return null;
  return (last.price / start.price - 1) * 100;
}

function bestWorstRollingTradingWindow(points: PricePoint[], span: number): { bestPct: number; worstPct: number } | null {
  if (points.length < span + 1) return null;
  let best = -Infinity;
  let worst = Infinity;
  for (let i = 0; i <= points.length - span - 1; i += 1) {
    const p0 = points[i]!.price;
    const p1 = points[i + span]!.price;
    if (p0 <= 0) continue;
    const r = (p1 / p0 - 1) * 100;
    if (r > best) best = r;
    if (r < worst) worst = r;
  }
  if (!Number.isFinite(best) || !Number.isFinite(worst)) return null;
  return { bestPct: best, worstPct: worst };
}

export async function getFundDetailPageData(rawCode: string): Promise<FundDetailPageData | null> {
  const trimmed = rawCode.trim();
  if (!trimmed) return null;

  const fund = await prisma.fund.findFirst({
    where: { code: { equals: trimmed, mode: "insensitive" } },
    select: {
      id: true,
      code: true,
      name: true,
      shortName: true,
      description: true,
      logoUrl: true,
      lastPrice: true,
      dailyReturn: true,
      weeklyReturn: true,
      monthlyReturn: true,
      yearlyReturn: true,
      portfolioSize: true,
      investorCount: true,
      lastUpdatedAt: true,
      updatedAt: true,
      categoryId: true,
      category: { select: { code: true, name: true } },
      fundType: { select: { code: true, name: true } },
    },
  });

  if (!fund) return null;

  const [historyRows, latestSnap, similarRows] = await Promise.all([
    prisma.fundPriceHistory.findMany({
      where: { fundId: fund.id },
      orderBy: { date: "desc" },
      take: HISTORY_CAP,
      select: { date: true, price: true, dailyReturn: true },
    }),
    prisma.fundDailySnapshot.findFirst({
      where: { fundId: fund.id },
      orderBy: { date: "desc" },
      select: { date: true, riskLevel: true, metrics: true, alpha: true },
    }),
    fund.categoryId
      ? prisma.fund.findMany({
          where: {
            categoryId: fund.categoryId,
            id: { not: fund.id },
            isActive: true,
          },
          orderBy: { portfolioSize: "desc" },
          take: 5,
          select: {
            id: true,
            code: true,
            name: true,
            shortName: true,
            lastPrice: true,
            dailyReturn: true,
            logoUrl: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const ascHistory = [...historyRows].reverse();
  const points = dedupeSessionPricePoints(ascHistory.map((r) => ({ date: r.date, price: r.price })));
  const priceSeries: FundDetailPricePoint[] = points.map((pt) => ({
    t: pt.date.getTime(),
    p: pt.price,
  }));

  const historyMetrics = points.length >= 2 ? calculateAllMetrics(points) : null;
  const bestWorstDay =
    ascHistory.length > 0 ? bestWorstDailyReturn(ascHistory.map((r) => ({ dailyReturn: r.dailyReturn }))) : null;

  const snapshotMetrics = latestSnap ? parseFundMetricsJson(latestSnap.metrics) : null;
  const riskFromSnap = latestSnap ? parseRiskLevel(latestSnap.riskLevel) : null;
  const categoryCode = fund.category?.code ?? "";
  const riskLevel = riskFromSnap ?? determineRiskLevel(categoryCode, fund.name);

  const ft = fund.fundType;
  const fundTypeResolved = ft
    ? { code: ft.code, name: fundTypeDisplayLabel({ code: ft.code, name: ft.name }) }
    : null;

  const rolling = bestWorstRollingTradingWindow(points, ROLLING_TRADING_DAYS);
  const derivedSummary: FundDetailDerivedSummary = {
    returnApprox1YearPct: returnApproxCalendarDays(points, 365),
    returnApprox2YearPct: returnApproxCalendarDays(points, 730),
    bestRollingMonthPct: rolling?.bestPct ?? null,
    worstRollingMonthPct: rolling?.worstPct ?? null,
  };

  const benchCode = categoryCode ? getBenchmarkForCategory(categoryCode) : null;
  const modelBenchmark =
    benchCode && categoryCode
      ? { code: benchCode, label: getBenchmarkName(benchCode) }
      : null;

  const snapshotAlpha =
    latestSnap && Number.isFinite(latestSnap.alpha) ? latestSnap.alpha : null;

  const similarFunds: FundDetailSimilarFund[] = await Promise.all(
    similarRows.map(async (row) => ({
      code: row.code,
      name: row.name,
      shortName: row.shortName,
      lastPrice: row.lastPrice,
      dailyReturn: row.dailyReturn,
      logoUrl: getFundLogoUrlForUi(row.id, row.code, row.logoUrl, row.name),
    }))
  );

  return {
    fund: {
      code: fund.code,
      name: fund.name,
      shortName: fund.shortName,
      description: fund.description,
      lastPrice: fund.lastPrice,
      dailyReturn: fund.dailyReturn,
      weeklyReturn: fund.weeklyReturn,
      monthlyReturn: fund.monthlyReturn,
      yearlyReturn: fund.yearlyReturn,
      portfolioSize: fund.portfolioSize,
      investorCount: fund.investorCount,
      category: fund.category,
      fundType: fundTypeResolved,
      logoUrl: getFundLogoUrlForUi(fund.id, fund.code, fund.logoUrl, fund.name),
      lastUpdatedAt: fund.lastUpdatedAt ? fund.lastUpdatedAt.toISOString() : null,
      updatedAt: fund.updatedAt.toISOString(),
      portfolioManagerInferred: inferPortfolioManagerFromFundName(fund.name),
    },
    snapshotDate: latestSnap?.date ? latestSnap.date.toISOString() : null,
    snapshotAlpha,
    riskLevel,
    snapshotMetrics,
    priceSeries,
    historyMetrics,
    bestWorstDay,
    modelBenchmark,
    tradingCurrency: "TRY",
    derivedSummary,
    similarFunds,
  };
}

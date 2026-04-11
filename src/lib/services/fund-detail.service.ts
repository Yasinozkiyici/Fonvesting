import { unstable_cache } from "next/cache";
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
import {
  buildFundAlternatives,
  FUND_ALTERNATIVES_CANDIDATE_POOL,
  type FundAlternativeCandidate,
} from "@/lib/fund-detail-alternatives";
import {
  buildFundKiyasBlock,
  type FundKiyasViewPayload,
} from "@/lib/services/fund-detail-kiyas.service";
import { LIVE_DATA_CACHE_SEC } from "@/lib/data-freshness";
import { fetchSupabaseRestJson, hasSupabaseRestConfig } from "@/lib/supabase-rest";

const DAY_MS = 86400000;
const DETAIL_HISTORY_LOOKBACK_DAYS = 1095;
const ROLLING_TRADING_DAYS = 21;
const DETAIL_PRICE_SERIES_MAX_POINTS = 240;
const DETAIL_TREND_SERIES_MAX_POINTS = 180;
const DETAIL_HISTORY_FETCH_LIMIT = 1200;

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

function downsampleTimeSeries<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points;
  if (maxPoints <= 2) return [points[0]!, points[points.length - 1]!];

  const result: T[] = [points[0]!];
  const middleCount = maxPoints - 2;
  const lastIndex = points.length - 1;
  for (let index = 1; index <= middleCount; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (middleCount + 1));
    const point = points[sourceIndex];
    if (point && point !== result[result.length - 1]) {
      result.push(point);
    }
  }
  if (result[result.length - 1] !== points[lastIndex]) {
    result.push(points[lastIndex]!);
  }
  return result;
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
export type FundDetailTrendPoint = { t: number; v: number };

export type FundDetailSimilarFund = {
  code: string;
  name: string;
  shortName: string | null;
  lastPrice: number;
  dailyReturn: number;
  yearlyReturn: number;
  logoUrl: string | null;
  /** Seçim notu; alternatifler bloğunda tek satır, sakin ton. */
  reasonLabel: string;
};

/** Fiyat geçmişinden türetilen özetler (risk bölümü). */
export type FundDetailDerivedSummary = {
  /** Son gözlemden geriye ~365 gün veya mevcut seri başı. */
  returnApprox1YearPct: number | null;
  /** Son gözlemden geriye ~730 gün veya mevcut seri başı. */
  returnApprox2YearPct: number | null;
  /** Son gözlemden geriye ~1095 gün veya mevcut seri başı. */
  returnApprox3YearPct: number | null;
  /** Ardışık ~21 işlem günü pencereleri içinde en yüksek birikimli getiri (%). */
  bestRollingMonthPct: number | null;
  /** Aynı tanım için en düşük birikimli getiri (%). */
  worstRollingMonthPct: number | null;
};

/** Aynı günlük kesitte kategorideki diğer fonların TEFAS getiri ortalaması (bu fon hariç). */
export type FundCategoryReturnAverages = {
  sampleSize: number;
  avgDailyReturn: number | null;
  avgMonthlyReturn: number | null;
  avgYearlyReturn: number | null;
};

const MIN_CATEGORY_RETURN_SAMPLE = 5;

async function loadCategoryReturnAverages(
  fundId: string,
  categoryCode: string | null | undefined,
  snapshotDate: Date | null | undefined
): Promise<FundCategoryReturnAverages | null> {
  const code = typeof categoryCode === "string" ? categoryCode.trim() : "";
  if (!code || !snapshotDate) return null;
  const where = { categoryCode: code, date: snapshotDate, fundId: { not: fundId } };
  const [agg, count] = await Promise.all([
    prisma.fundDailySnapshot.aggregate({
      where,
      _avg: { dailyReturn: true, monthlyReturn: true, yearlyReturn: true },
    }),
    prisma.fundDailySnapshot.count({ where }),
  ]);
  if (count < MIN_CATEGORY_RETURN_SAMPLE) return null;
  return {
    sampleSize: count,
    avgDailyReturn: agg._avg.dailyReturn,
    avgMonthlyReturn: agg._avg.monthlyReturn,
    avgYearlyReturn: agg._avg.yearlyReturn,
  };
}

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
  /**
   * Aynı kategorideki geniş aday havuzunun günlük getirileri (içgörü istatistiği).
   * UI’da kullanılmaz; `similarFunds` seçkisi dar tutulduğunda medyan vb. için.
   */
  similarCategoryPeerDailyReturns: number[];
  categoryReturnAverages: FundCategoryReturnAverages | null;
  /** Veri tabanı referans serileri + kategori türev ortalaması ile kıyas; yoksa UI eski TEFAS kıyasına döner. */
  kiyasBlock: FundKiyasViewPayload | null;
  trendSeries: {
    portfolioSize: FundDetailTrendPoint[];
    investorCount: FundDetailTrendPoint[];
  };
};

type FundHistoryRow = {
  date: Date;
  price: number;
  dailyReturn: number;
  portfolioSize: number;
  investorCount: number;
};

type DerivedMetricsRow = {
  return30d: number | null;
  return90d: number | null;
  return180d: number | null;
  return1y: number | null;
  return2y: number | null;
  volatility1y: number | null;
  maxDrawdown1y: number | null;
  annualizedReturn1y: number;
  sharpe1y: number;
  sortino1y: number;
  totalReturn2y: number | null;
  historySessions: number;
};

type SupabaseLatestSnapshotRow = {
  date: string;
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  fundTypeCode: number | null;
  fundTypeName: string | null;
  riskLevel: string;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  alpha: number;
  metrics: unknown;
};

type SupabaseFundCoreRow = {
  id: string;
  categoryId: string | null;
  description: string | null;
  weeklyReturn: number;
  lastUpdatedAt: string | null;
  updatedAt: string;
};

type SupabaseHistoryRow = {
  date: string;
  price: number;
  dailyReturn: number;
  portfolioSize: number;
  investorCount: number;
};

type SupabaseSimilarSnapshotRow = {
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  lastPrice: number;
  dailyReturn: number;
  logoUrl: string | null;
  portfolioSize: number;
  investorCount: number;
  monthlyReturn: number;
  yearlyReturn: number;
};

function toHistoryMetricsFromDerived(row: DerivedMetricsRow): FundMetrics {
  return {
    totalReturn: row.totalReturn2y ?? row.return1y ?? 0,
    annualizedReturn: row.annualizedReturn1y,
    volatility: row.volatility1y ?? 0,
    maxDrawdown: row.maxDrawdown1y ?? 0,
    sharpeRatio: row.sharpe1y,
    sortinoRatio: row.sortino1y,
    calmarRatio: 0,
    winRate: 0,
    avgGain: 0,
    avgLoss: 0,
    dataPoints: row.historySessions,
  };
}

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

async function getFundDetailPageDataFromSupabaseRest(rawCode: string): Promise<FundDetailPageData | null> {
  if (!hasSupabaseRestConfig()) {
    throw new Error("supabase_rest_not_configured");
  }

  const normalizedCode = rawCode.trim().toUpperCase();
  if (!normalizedCode) return null;

  const latestSnapshots = await fetchSupabaseRestJson<SupabaseLatestSnapshotRow[]>(
    `FundDailySnapshot?select=date,fundId,code,name,shortName,logoUrl,categoryCode,categoryName,fundTypeCode,fundTypeName,riskLevel,lastPrice,dailyReturn,monthlyReturn,yearlyReturn,portfolioSize,investorCount,alpha,metrics&code=eq.${normalizedCode}&order=date.desc&limit=1`,
    { revalidate: LIVE_DATA_CACHE_SEC }
  );
  const latestSnapshot = latestSnapshots[0];
  if (!latestSnapshot) return null;

  const [fundRows, derivedRows] = await Promise.all([
    fetchSupabaseRestJson<SupabaseFundCoreRow[]>(
      `Fund?select=id,categoryId,description,weeklyReturn,lastUpdatedAt,updatedAt&id=eq.${latestSnapshot.fundId}&limit=1`,
      { revalidate: LIVE_DATA_CACHE_SEC }
    ),
    fetchSupabaseRestJson<DerivedMetricsRow[]>(
      `FundDerivedMetrics?select=return30d,return90d,return180d,return1y,return2y,volatility1y,maxDrawdown1y,annualizedReturn1y,sharpe1y,sortino1y,totalReturn2y,historySessions&fundId=eq.${latestSnapshot.fundId}&limit=1`,
      { revalidate: LIVE_DATA_CACHE_SEC }
    ),
  ]);
  const fundCore = fundRows[0];
  if (!fundCore) return null;
  const derivedMetrics = derivedRows[0] ?? null;

  const historyFromIso = new Date(new Date(latestSnapshot.date).getTime() - DETAIL_HISTORY_LOOKBACK_DAYS * DAY_MS).toISOString();
  const historyRowsRaw = await fetchSupabaseRestJson<SupabaseHistoryRow[]>(
    `FundPriceHistory?select=date,price,dailyReturn,portfolioSize,investorCount&fundId=eq.${latestSnapshot.fundId}&date=gte.${historyFromIso}&date=lte.${latestSnapshot.date}&order=date.desc&limit=${DETAIL_HISTORY_FETCH_LIMIT}`,
    { revalidate: LIVE_DATA_CACHE_SEC }
  );
  const historyRows: FundHistoryRow[] = historyRowsRaw.map((row) => ({
    date: new Date(row.date),
    price: row.price,
    dailyReturn: row.dailyReturn,
    portfolioSize: row.portfolioSize,
    investorCount: row.investorCount,
  }));

  const similarSnapshotRows = latestSnapshot.categoryCode
    ? await fetchSupabaseRestJson<SupabaseSimilarSnapshotRow[]>(
        `FundDailySnapshot?select=fundId,code,name,shortName,lastPrice,dailyReturn,logoUrl,portfolioSize,investorCount,monthlyReturn,yearlyReturn&date=eq.${latestSnapshot.date}&categoryCode=eq.${latestSnapshot.categoryCode}&fundId=neq.${latestSnapshot.fundId}&order=portfolioSize.desc&limit=${FUND_ALTERNATIVES_CANDIDATE_POOL}`,
        { revalidate: LIVE_DATA_CACHE_SEC }
      )
    : [];

  const ascHistory = [...historyRows].reverse() as FundHistoryRow[];
  const points = dedupeSessionPricePoints(ascHistory.map((row) => ({ date: row.date, price: row.price })));
  const priceSeries: FundDetailPricePoint[] = downsampleTimeSeries(points, DETAIL_PRICE_SERIES_MAX_POINTS).map((point) => ({
    t: point.date.getTime(),
    p: point.price,
  }));

  const historyMetrics = derivedMetrics
    ? toHistoryMetricsFromDerived(derivedMetrics)
    : points.length >= 2
      ? calculateAllMetrics(points)
      : null;
  const bestWorstDay =
    ascHistory.length > 0 ? bestWorstDailyReturn(ascHistory.map((row) => ({ dailyReturn: row.dailyReturn }))) : null;
  const snapshotMetrics = parseFundMetricsJson(latestSnapshot.metrics);
  const categoryCode = latestSnapshot.categoryCode ?? "";
  const riskLevel = parseRiskLevel(latestSnapshot.riskLevel) ?? determineRiskLevel(categoryCode, latestSnapshot.name);

  const fundTypeResolved =
    latestSnapshot.fundTypeCode != null && latestSnapshot.fundTypeName
      ? {
          code: latestSnapshot.fundTypeCode,
          name: fundTypeDisplayLabel({
            code: latestSnapshot.fundTypeCode,
            name: latestSnapshot.fundTypeName,
          }),
        }
      : null;

  const rolling = bestWorstRollingTradingWindow(points, ROLLING_TRADING_DAYS);
  const derivedSummary: FundDetailDerivedSummary = {
    returnApprox1YearPct: derivedMetrics?.return1y ?? returnApproxCalendarDays(points, 365),
    returnApprox2YearPct: derivedMetrics?.return2y ?? returnApproxCalendarDays(points, 730),
    returnApprox3YearPct: returnApproxCalendarDays(points, 1095),
    bestRollingMonthPct: rolling?.bestPct ?? null,
    worstRollingMonthPct: rolling?.worstPct ?? null,
  };

  const benchCode = categoryCode ? getBenchmarkForCategory(categoryCode) : null;
  const modelBenchmark = benchCode ? { code: benchCode, label: getBenchmarkName(benchCode) } : null;

  const categoryReturnAverages = null;

  const kiyasBlock = await buildFundKiyasBlock({
    fundId: latestSnapshot.fundId,
    categoryId: fundCore.categoryId,
    categoryCode: latestSnapshot.categoryCode,
    fundName: latestSnapshot.name,
    fundTypeCode: latestSnapshot.fundTypeCode,
    anchorDate: new Date(latestSnapshot.date),
    derived: derivedMetrics
      ? {
          return30d: derivedMetrics.return30d,
          return90d: derivedMetrics.return90d,
          return180d: derivedMetrics.return180d,
          return1y: derivedMetrics.return1y,
          return2y: derivedMetrics.return2y,
          return3y: null,
        }
      : null,
    pricePoints: points,
  });
  const trendSeries = buildTrendSeries(ascHistory);

  return {
    fund: {
      code: latestSnapshot.code,
      name: latestSnapshot.name,
      shortName: latestSnapshot.shortName,
      description: fundCore.description,
      lastPrice: latestSnapshot.lastPrice,
      dailyReturn: latestSnapshot.dailyReturn,
      weeklyReturn: fundCore.weeklyReturn,
      monthlyReturn: latestSnapshot.monthlyReturn,
      yearlyReturn: latestSnapshot.yearlyReturn,
      portfolioSize: latestSnapshot.portfolioSize,
      investorCount: latestSnapshot.investorCount,
      category:
        latestSnapshot.categoryCode && latestSnapshot.categoryName
          ? { code: latestSnapshot.categoryCode, name: latestSnapshot.categoryName }
          : null,
      fundType: fundTypeResolved,
      logoUrl: getFundLogoUrlForUi(latestSnapshot.fundId, latestSnapshot.code, latestSnapshot.logoUrl, latestSnapshot.name),
      lastUpdatedAt: fundCore.lastUpdatedAt,
      updatedAt: fundCore.updatedAt,
      portfolioManagerInferred: inferPortfolioManagerFromFundName(latestSnapshot.name),
    },
    snapshotDate: new Date(latestSnapshot.date).toISOString(),
    snapshotAlpha: Number.isFinite(latestSnapshot.alpha) ? latestSnapshot.alpha : null,
    riskLevel,
    snapshotMetrics,
    priceSeries,
    historyMetrics,
    bestWorstDay,
    modelBenchmark,
    tradingCurrency: "TRY",
    derivedSummary,
    similarFunds: buildFundAlternatives(
      {
        portfolioSize: latestSnapshot.portfolioSize,
        investorCount: latestSnapshot.investorCount,
        dailyReturn: latestSnapshot.dailyReturn,
        monthlyReturn: latestSnapshot.monthlyReturn,
        yearlyReturn: latestSnapshot.yearlyReturn,
      },
      similarSnapshotRows.map((row) => ({
        code: row.code,
        name: row.name,
        shortName: row.shortName,
        lastPrice: row.lastPrice,
        dailyReturn: row.dailyReturn,
        logoUrl: getFundLogoUrlForUi(row.fundId, row.code, row.logoUrl, row.name),
        portfolioSize: row.portfolioSize,
        investorCount: row.investorCount,
        monthlyReturn: row.monthlyReturn,
        yearlyReturn: row.yearlyReturn,
      }))
    ),
    similarCategoryPeerDailyReturns: similarSnapshotRows
      .map((row) => row.dailyReturn)
      .filter((x) => Number.isFinite(x)),
    categoryReturnAverages,
    kiyasBlock,
    trendSeries,
  };
}

function buildTrendSeries(rows: FundHistoryRow[]): {
  portfolioSize: FundDetailTrendPoint[];
  investorCount: FundDetailTrendPoint[];
} {
  const bySession = new Map<number, { portfolioSize: number | null; investorCount: number | null }>();
  for (const row of rows) {
    const key = normalizeHistorySessionDate(row.date).getTime();
    const current = bySession.get(key) ?? { portfolioSize: null, investorCount: null };
    if (Number.isFinite(row.portfolioSize) && row.portfolioSize > 0) {
      current.portfolioSize = row.portfolioSize;
    }
    if (Number.isFinite(row.investorCount) && row.investorCount >= 0) {
      current.investorCount = row.investorCount;
    }
    bySession.set(key, current);
  }
  const ordered = [...bySession.entries()].sort((a, b) => a[0] - b[0]);
  return {
    portfolioSize: downsampleTimeSeries(
      ordered
      .filter(([, value]) => value.portfolioSize != null)
      .map(([t, value]) => ({ t, v: value.portfolioSize as number })),
      DETAIL_TREND_SERIES_MAX_POINTS
    ),
    investorCount: downsampleTimeSeries(
      ordered
      .filter(([, value]) => value.investorCount != null)
      .map(([t, value]) => ({ t, v: value.investorCount as number })),
      DETAIL_TREND_SERIES_MAX_POINTS
    ),
  };
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

async function getFundDetailPageDataLegacy(rawCode: string): Promise<FundDetailPageData | null> {
  const normalizedCode = rawCode.trim().toUpperCase();
  if (!normalizedCode) return null;

  const fund = await prisma.fund.findFirst({
    where: { code: normalizedCode },
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

  const historyFromDate = new Date(Date.now() - DETAIL_HISTORY_LOOKBACK_DAYS * DAY_MS);

  const [historyRows, latestSnap, similarRows] = await Promise.all([
    prisma.fundPriceHistory.findMany({
      where: { fundId: fund.id, date: { gte: historyFromDate } },
      orderBy: { date: "desc" },
      select: { date: true, price: true, dailyReturn: true, portfolioSize: true, investorCount: true },
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
          take: FUND_ALTERNATIVES_CANDIDATE_POOL,
          select: {
            id: true,
            code: true,
            name: true,
            shortName: true,
            lastPrice: true,
            dailyReturn: true,
            logoUrl: true,
            portfolioSize: true,
            investorCount: true,
            monthlyReturn: true,
            yearlyReturn: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const ascHistory = [...historyRows].reverse() as FundHistoryRow[];
  const points = dedupeSessionPricePoints(ascHistory.map((r) => ({ date: r.date, price: r.price })));
  const priceSeries: FundDetailPricePoint[] = downsampleTimeSeries(points, DETAIL_PRICE_SERIES_MAX_POINTS).map((pt) => ({
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
    returnApprox3YearPct: returnApproxCalendarDays(points, 1095),
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

  const similarCandidates: FundAlternativeCandidate[] = similarRows.map((row) => ({
    code: row.code,
    name: row.name,
    shortName: row.shortName,
    lastPrice: row.lastPrice,
    dailyReturn: row.dailyReturn,
    logoUrl: getFundLogoUrlForUi(row.id, row.code, row.logoUrl, row.name),
    portfolioSize: row.portfolioSize,
    investorCount: row.investorCount,
    monthlyReturn: row.monthlyReturn,
    yearlyReturn: row.yearlyReturn,
  }));

  const similarCategoryPeerDailyReturns = similarCandidates
    .map((c) => c.dailyReturn)
    .filter((x) => Number.isFinite(x));

  const similarFunds: FundDetailSimilarFund[] = buildFundAlternatives(
    {
      portfolioSize: fund.portfolioSize,
      investorCount: fund.investorCount,
      dailyReturn: fund.dailyReturn,
      monthlyReturn: fund.monthlyReturn,
      yearlyReturn: fund.yearlyReturn,
    },
    similarCandidates
  );

  const categoryReturnAverages = await loadCategoryReturnAverages(
    fund.id,
    fund.category?.code ?? null,
    latestSnap?.date ?? null
  );

  const derivedForKiyas = await prisma.fundDerivedMetrics.findUnique({
    where: { fundId: fund.id },
    select: {
      return30d: true,
      return90d: true,
      return180d: true,
      return1y: true,
      return2y: true,
    },
  });
  const anchorForKiyas = latestSnap?.date ?? points[points.length - 1]?.date ?? new Date();
  const kiyasBlock = await buildFundKiyasBlock({
    fundId: fund.id,
    categoryId: fund.categoryId,
    categoryCode: fund.category?.code ?? null,
    fundName: fund.name,
    fundTypeCode: fund.fundType?.code ?? null,
    anchorDate: anchorForKiyas,
    // 3Y türevi henüz tabloda ayrı saklanmıyor; history fallback devreye girer.
    derived: derivedForKiyas ? { ...derivedForKiyas, return3y: null } : null,
    pricePoints: points,
  });
  const trendSeries = buildTrendSeries(ascHistory);

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
    similarCategoryPeerDailyReturns,
    categoryReturnAverages,
    kiyasBlock,
    trendSeries,
  };
}

async function getFundDetailPageDataUncached(rawCode: string): Promise<FundDetailPageData | null> {
  const normalizedCode = rawCode.trim().toUpperCase();
  if (!normalizedCode) return null;

  if (hasSupabaseRestConfig()) {
    try {
      return await getFundDetailPageDataFromSupabaseRest(normalizedCode);
    } catch (error) {
      console.error("[fund-detail] supabase-rest fast path failed", error);
    }
  }

  const latestSnapshot = await prisma.fundDailySnapshot.findFirst({
    where: { code: normalizedCode },
    orderBy: { date: "desc" },
    select: {
      date: true,
      fundId: true,
      code: true,
      name: true,
      shortName: true,
      logoUrl: true,
      categoryCode: true,
      categoryName: true,
      fundTypeCode: true,
      fundTypeName: true,
      riskLevel: true,
      lastPrice: true,
      dailyReturn: true,
      monthlyReturn: true,
      yearlyReturn: true,
      portfolioSize: true,
      investorCount: true,
      alpha: true,
      metrics: true,
      fund: {
        select: {
          id: true,
          categoryId: true,
          description: true,
          weeklyReturn: true,
          lastUpdatedAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!latestSnapshot) {
    return getFundDetailPageDataLegacy(normalizedCode);
  }

  const historyFromDate = new Date(latestSnapshot.date.getTime() - DETAIL_HISTORY_LOOKBACK_DAYS * DAY_MS);

  const [historyRows, derivedMetrics, similarSnapshotRows, categoryReturnAverages] = await Promise.all([
    prisma.fundPriceHistory.findMany({
      where: {
        fundId: latestSnapshot.fundId,
        date: { gte: historyFromDate, lte: latestSnapshot.date },
      },
      orderBy: { date: "desc" },
      select: { date: true, price: true, dailyReturn: true, portfolioSize: true, investorCount: true },
    }),
    prisma.fundDerivedMetrics.findUnique({
      where: { fundId: latestSnapshot.fundId },
      select: {
        return30d: true,
        return90d: true,
        return180d: true,
        return1y: true,
        return2y: true,
        volatility1y: true,
        maxDrawdown1y: true,
        annualizedReturn1y: true,
        sharpe1y: true,
        sortino1y: true,
        totalReturn2y: true,
        historySessions: true,
      },
    }),
    latestSnapshot.categoryCode
      ? prisma.fundDailySnapshot.findMany({
          where: {
            date: latestSnapshot.date,
            categoryCode: latestSnapshot.categoryCode,
            fundId: { not: latestSnapshot.fundId },
          },
          orderBy: { portfolioSize: "desc" },
          take: FUND_ALTERNATIVES_CANDIDATE_POOL,
          select: {
            fundId: true,
            code: true,
            name: true,
            shortName: true,
            lastPrice: true,
            dailyReturn: true,
            logoUrl: true,
            portfolioSize: true,
            investorCount: true,
            monthlyReturn: true,
            yearlyReturn: true,
          },
        })
      : Promise.resolve([]),
    loadCategoryReturnAverages(latestSnapshot.fundId, latestSnapshot.categoryCode, latestSnapshot.date),
  ]);

  const similarFallbackRows =
    similarSnapshotRows.length === 0 && latestSnapshot.fund.categoryId
      ? await prisma.fund.findMany({
          where: {
            categoryId: latestSnapshot.fund.categoryId,
            id: { not: latestSnapshot.fund.id },
            isActive: true,
          },
          orderBy: { portfolioSize: "desc" },
          take: FUND_ALTERNATIVES_CANDIDATE_POOL,
          select: {
            id: true,
            code: true,
            name: true,
            shortName: true,
            lastPrice: true,
            dailyReturn: true,
            logoUrl: true,
            portfolioSize: true,
            investorCount: true,
            monthlyReturn: true,
            yearlyReturn: true,
          },
        })
      : [];

  const ascHistory = [...historyRows].reverse() as FundHistoryRow[];
  const points = dedupeSessionPricePoints(ascHistory.map((row) => ({ date: row.date, price: row.price })));
  const priceSeries: FundDetailPricePoint[] = downsampleTimeSeries(points, DETAIL_PRICE_SERIES_MAX_POINTS).map((point) => ({
    t: point.date.getTime(),
    p: point.price,
  }));

  const historyMetrics = derivedMetrics
    ? toHistoryMetricsFromDerived(derivedMetrics)
    : points.length >= 2
      ? calculateAllMetrics(points)
      : null;
  const bestWorstDay =
    ascHistory.length > 0 ? bestWorstDailyReturn(ascHistory.map((row) => ({ dailyReturn: row.dailyReturn }))) : null;
  const snapshotMetrics = parseFundMetricsJson(latestSnapshot.metrics);
  const categoryCode = latestSnapshot.categoryCode ?? "";
  const riskLevel = parseRiskLevel(latestSnapshot.riskLevel) ?? determineRiskLevel(categoryCode, latestSnapshot.name);

  const fundTypeResolved =
    latestSnapshot.fundTypeCode != null && latestSnapshot.fundTypeName
      ? {
          code: latestSnapshot.fundTypeCode,
          name: fundTypeDisplayLabel({
            code: latestSnapshot.fundTypeCode,
            name: latestSnapshot.fundTypeName,
          }),
        }
      : null;

  const rolling = bestWorstRollingTradingWindow(points, ROLLING_TRADING_DAYS);
  const derivedSummary: FundDetailDerivedSummary = {
    returnApprox1YearPct: derivedMetrics?.return1y ?? returnApproxCalendarDays(points, 365),
    returnApprox2YearPct: derivedMetrics?.return2y ?? returnApproxCalendarDays(points, 730),
    returnApprox3YearPct: returnApproxCalendarDays(points, 1095),
    bestRollingMonthPct: rolling?.bestPct ?? null,
    worstRollingMonthPct: rolling?.worstPct ?? null,
  };

  const benchCode = categoryCode ? getBenchmarkForCategory(categoryCode) : null;
  const modelBenchmark = benchCode ? { code: benchCode, label: getBenchmarkName(benchCode) } : null;

  const kiyasBlock = await buildFundKiyasBlock({
    fundId: latestSnapshot.fundId,
    categoryId: latestSnapshot.fund.categoryId,
    categoryCode: latestSnapshot.categoryCode,
    fundName: latestSnapshot.name,
    fundTypeCode: latestSnapshot.fundTypeCode,
    anchorDate: latestSnapshot.date,
    derived: derivedMetrics
      ? {
          return30d: derivedMetrics.return30d,
          return90d: derivedMetrics.return90d,
          return180d: derivedMetrics.return180d,
          return1y: derivedMetrics.return1y,
          return2y: derivedMetrics.return2y,
          return3y: null,
        }
      : null,
    pricePoints: points,
  });
  const trendSeries = buildTrendSeries(ascHistory);

  return {
    fund: {
      code: latestSnapshot.code,
      name: latestSnapshot.name,
      shortName: latestSnapshot.shortName,
      description: latestSnapshot.fund.description,
      lastPrice: latestSnapshot.lastPrice,
      dailyReturn: latestSnapshot.dailyReturn,
      weeklyReturn: latestSnapshot.fund.weeklyReturn,
      monthlyReturn: latestSnapshot.monthlyReturn,
      yearlyReturn: latestSnapshot.yearlyReturn,
      portfolioSize: latestSnapshot.portfolioSize,
      investorCount: latestSnapshot.investorCount,
      category:
        latestSnapshot.categoryCode && latestSnapshot.categoryName
          ? { code: latestSnapshot.categoryCode, name: latestSnapshot.categoryName }
          : null,
      fundType: fundTypeResolved,
      logoUrl: getFundLogoUrlForUi(
        latestSnapshot.fund.id,
        latestSnapshot.code,
        latestSnapshot.logoUrl,
        latestSnapshot.name
      ),
      lastUpdatedAt: latestSnapshot.fund.lastUpdatedAt ? latestSnapshot.fund.lastUpdatedAt.toISOString() : null,
      updatedAt: latestSnapshot.fund.updatedAt.toISOString(),
      portfolioManagerInferred: inferPortfolioManagerFromFundName(latestSnapshot.name),
    },
    snapshotDate: latestSnapshot.date.toISOString(),
    snapshotAlpha: Number.isFinite(latestSnapshot.alpha) ? latestSnapshot.alpha : null,
    riskLevel,
    snapshotMetrics,
    priceSeries,
    historyMetrics,
    bestWorstDay,
    modelBenchmark,
    tradingCurrency: "TRY",
    derivedSummary,
    similarFunds: buildFundAlternatives(
      {
        portfolioSize: latestSnapshot.portfolioSize,
        investorCount: latestSnapshot.investorCount,
        dailyReturn: latestSnapshot.dailyReturn,
        monthlyReturn: latestSnapshot.monthlyReturn,
        yearlyReturn: latestSnapshot.yearlyReturn,
      },
      similarSnapshotRows.length > 0
        ? similarSnapshotRows.map((row) => ({
            code: row.code,
            name: row.name,
            shortName: row.shortName,
            lastPrice: row.lastPrice,
            dailyReturn: row.dailyReturn,
            logoUrl: getFundLogoUrlForUi(row.fundId, row.code, row.logoUrl, row.name),
            portfolioSize: row.portfolioSize,
            investorCount: row.investorCount,
            monthlyReturn: row.monthlyReturn,
            yearlyReturn: row.yearlyReturn,
          }))
        : similarFallbackRows.map((row) => ({
            code: row.code,
            name: row.name,
            shortName: row.shortName,
            lastPrice: row.lastPrice,
            dailyReturn: row.dailyReturn,
            logoUrl: getFundLogoUrlForUi(row.id, row.code, row.logoUrl, row.name),
            portfolioSize: row.portfolioSize,
            investorCount: row.investorCount,
            monthlyReturn: row.monthlyReturn,
            yearlyReturn: row.yearlyReturn,
          }))
    ),
    similarCategoryPeerDailyReturns: (similarSnapshotRows.length > 0 ? similarSnapshotRows : similarFallbackRows)
      .map((row) => row.dailyReturn)
      .filter((x) => Number.isFinite(x)),
    categoryReturnAverages,
    kiyasBlock,
    trendSeries,
  };
}

export async function getFundDetailPageData(rawCode: string): Promise<FundDetailPageData | null> {
  const normalizedCode = rawCode.trim().toUpperCase();
  if (!normalizedCode) return null;
  const loadCached = unstable_cache(
    () => getFundDetailPageDataUncached(normalizedCode),
    ["fund-detail-v8", normalizedCode],
    { revalidate: LIVE_DATA_CACHE_SEC }
  );
  return loadCached();
}

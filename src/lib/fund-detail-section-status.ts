import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

export type FundDetailSectionState = "full" | "partial" | "no_data";

export type FundDetailSectionStates = {
  performance: FundDetailSectionState;
  trends: FundDetailSectionState;
  risk: FundDetailSectionState;
  comparison: FundDetailSectionState;
};

export type FundDetailDataTier = "FULL" | "PARTIAL" | "LOW_DATA" | "NO_USEFUL_DATA";

export type FundDetailBehaviorContract = {
  tier: FundDetailDataTier;
  thresholds: {
    minMainChartPoints: number;
    minTrendPoints: number;
    minComparisonValidRefs: number;
    fullMainChartPoints: number;
    fullTrendPoints: number;
  };
  canRenderMainChart: boolean;
  canRenderTrendCharts: boolean;
  canRenderComparison: boolean;
  canRenderAlternatives: boolean;
  hasLimitedCoverage: boolean;
  comparisonValidRefs: number;
  comparisonTotalRefs: number;
  pricePoints: number;
  priceCoverageDays: number;
  trendInvestorPoints: number;
  trendPortfolioPoints: number;
  limitedCoverageCopy: string | null;
  trendFallbackCopy: string;
  comparisonFallbackCopy: string;
  noUsefulDataCopy: string;
};

/**
 * Renderable payload coarse davranış bayraklarını ezer.
 * Bölüm ancak hem coarse contract "render edilemez" dediğinde
 * hem de somut payload render edilemez olduğunda fallback'e düşer.
 */
export function shouldRenderSectionFromContract(
  coarseCanRender: boolean,
  hasRenderablePayload: boolean
): boolean {
  return coarseCanRender || hasRenderablePayload;
}

const DAY_MS = 86_400_000;
const FULL_PRICE_POINTS = 96;
const FULL_PRICE_COVERAGE_DAYS = 540;
const FULL_PRICE_MAX_GAP_RATIO = 0.35;
const PRICE_GAP_THRESHOLD_DAYS = 7;
const FULL_TREND_POINTS = 20;
const MAX_PLAUSIBLE_VOLATILITY_PCT = 250;
const MAX_PLAUSIBLE_DRAWDOWN_PCT = 100;
const MIN_MAIN_CHART_POINTS = 2;
const MIN_TREND_POINTS = 2;
const MIN_COMPARISON_VALID_REFS = 1;
const LOW_DATA_MAX_PRICE_POINTS = 12;
const LOW_DATA_MAX_COVERAGE_DAYS = 45;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function countComparisonValidRows(data: FundDetailPageData): { valid: number; total: number } {
  const rowsByRef = data.kiyasBlock?.rowsByRef;
  if (!rowsByRef) return { valid: 0, total: 0 };
  let valid = 0;
  let total = 0;
  for (const rows of Object.values(rowsByRef)) {
    const row = rows.find((item) => item.periodId === "1y");
    if (!row) continue;
    total += 1;
    if (isFiniteNumber(row.fundPct) && isFiniteNumber(row.refPct)) {
      valid += 1;
    }
  }
  return { valid, total };
}

function performanceState(data: FundDetailPageData): FundDetailSectionState {
  const points = data.priceSeries
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0)
    .slice()
    .sort((a, b) => a.t - b.t);
  if (points.length < 2) return "no_data";

  const coverageDays = Math.max(0, Math.round((points[points.length - 1]!.t - points[0]!.t) / DAY_MS));
  let gaps = 0;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1]!;
    const current = points[index]!;
    const gapDays = Math.max(1, Math.round((current.t - prev.t) / DAY_MS));
    if (gapDays > PRICE_GAP_THRESHOLD_DAYS) gaps += 1;
  }
  const gapRatio = points.length > 1 ? gaps / (points.length - 1) : 1;
  const full =
    points.length >= FULL_PRICE_POINTS &&
    coverageDays >= FULL_PRICE_COVERAGE_DAYS &&
    gapRatio <= FULL_PRICE_MAX_GAP_RATIO;
  return full ? "full" : "partial";
}

function trendsState(data: FundDetailPageData): FundDetailSectionState {
  const investorPoints = data.trendSeries.investorCount.length;
  const portfolioPoints = data.trendSeries.portfolioSize.length;
  if (investorPoints >= FULL_TREND_POINTS && portfolioPoints >= FULL_TREND_POINTS) return "full";
  if (investorPoints >= 2 || portfolioPoints >= 2) return "partial";
  return "no_data";
}

function riskState(data: FundDetailPageData): FundDetailSectionState {
  const metrics = data.historyMetrics ?? data.snapshotMetrics;
  const hasVolatility =
    isFiniteNumber(metrics?.volatility) && metrics.volatility > 0 && metrics.volatility <= MAX_PLAUSIBLE_VOLATILITY_PCT;
  const hasDrawdown =
    isFiniteNumber(metrics?.maxDrawdown) && metrics.maxDrawdown > 0 && metrics.maxDrawdown <= MAX_PLAUSIBLE_DRAWDOWN_PCT;
  const has1y = isFiniteNumber(data.derivedSummary.returnApprox1YearPct);
  const has3y = isFiniteNumber(data.derivedSummary.returnApprox3YearPct);
  const riskSignals = [hasVolatility, hasDrawdown, has1y, has3y].filter(Boolean).length;
  if (riskSignals >= 2) return "full";
  if (riskSignals === 1) return "partial";
  return "no_data";
}

function comparisonState(data: FundDetailPageData): FundDetailSectionState {
  const { valid, total } = countComparisonValidRows(data);
  if (valid <= 0) return "no_data";
  if (total > 0 && valid < total) return "partial";
  return "full";
}

export function deriveFundDetailSectionStates(data: FundDetailPageData): FundDetailSectionStates {
  return {
    performance: performanceState(data),
    trends: trendsState(data),
    risk: riskState(data),
    comparison: comparisonState(data),
  };
}

function computePriceWindow(data: FundDetailPageData): { points: number; coverageDays: number } {
  const points = data.priceSeries
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0)
    .slice()
    .sort((a, b) => a.t - b.t);
  if (points.length < 2) return { points: points.length, coverageDays: 0 };
  const coverageDays = Math.max(0, Math.round((points[points.length - 1]!.t - points[0]!.t) / DAY_MS));
  return { points: points.length, coverageDays };
}

export function deriveFundDetailBehaviorContract(data: FundDetailPageData): FundDetailBehaviorContract {
  const sectionStates = deriveFundDetailSectionStates(data);
  const comparison = countComparisonValidRows(data);
  const price = computePriceWindow(data);
  const trendInvestorPoints = data.trendSeries.investorCount.length;
  const trendPortfolioPoints = data.trendSeries.portfolioSize.length;
  const canRenderMainChart = price.points >= MIN_MAIN_CHART_POINTS;
  const canRenderTrendCharts =
    trendInvestorPoints >= MIN_TREND_POINTS || trendPortfolioPoints >= MIN_TREND_POINTS;
  const canRenderComparison = comparison.valid >= MIN_COMPARISON_VALID_REFS;
  const canRenderAlternatives = data.similarFunds.length > 0;

  const noUseful =
    !canRenderMainChart &&
    !canRenderTrendCharts &&
    !canRenderComparison;

  const lowData =
    !noUseful &&
    canRenderMainChart &&
    price.points <= LOW_DATA_MAX_PRICE_POINTS &&
    price.coverageDays <= LOW_DATA_MAX_COVERAGE_DAYS;

  const full =
    sectionStates.performance === "full" &&
    sectionStates.trends === "full" &&
    sectionStates.comparison === "full";

  const tier: FundDetailDataTier = noUseful
    ? "NO_USEFUL_DATA"
    : full
      ? "FULL"
      : lowData
        ? "LOW_DATA"
        : "PARTIAL";

  const limitedCoverageCopy =
    tier === "PARTIAL"
      ? "Bazı alanlar mevcut veri penceresiyle gösteriliyor."
      : tier === "LOW_DATA"
        ? "Bu fonda veri penceresi şu an sınırlı."
        : null;

  return {
    tier,
    thresholds: {
      minMainChartPoints: MIN_MAIN_CHART_POINTS,
      minTrendPoints: MIN_TREND_POINTS,
      minComparisonValidRefs: MIN_COMPARISON_VALID_REFS,
      fullMainChartPoints: FULL_PRICE_POINTS,
      fullTrendPoints: FULL_TREND_POINTS,
    },
    canRenderMainChart,
    canRenderTrendCharts,
    canRenderComparison,
    canRenderAlternatives,
    hasLimitedCoverage: tier === "PARTIAL" || tier === "LOW_DATA",
    comparisonValidRefs: comparison.valid,
    comparisonTotalRefs: comparison.total,
    pricePoints: price.points,
    priceCoverageDays: price.coverageDays,
    trendInvestorPoints,
    trendPortfolioPoints,
    limitedCoverageCopy,
    trendFallbackCopy:
      tier === "LOW_DATA"
        ? "Trend görünümü mevcut veri penceresiyle gösteriliyor."
        : "Bu fonda trend kapsamı şu an sınırlı.",
    comparisonFallbackCopy:
      tier === "LOW_DATA"
        ? "Bu fonda karşılaştırma kapsamı şu an sınırlı."
        : "Karşılaştırma alanı, yeterli veri oluştuğunda otomatik zenginleşir.",
    noUsefulDataCopy:
      "Bu fonda şu an detaylı geçmiş görünümü oluşmadı. Veri geldikçe sayfa otomatik zenginleşir.",
  };
}

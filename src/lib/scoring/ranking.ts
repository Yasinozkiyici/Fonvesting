/**
 * Fund ranking system with multiple modes
 */

import type { FundMetrics } from "./metrics";

export type RankingMode = "BEST" | "LOW_RISK" | "HIGH_RETURN" | "STABLE";

export interface NormalizedScores {
  returnScore: number;      // 0-100, higher is better
  riskScore: number;        // 0-100, higher means MORE risky
  stabilityScore: number;   // 0-100, higher is more stable
  sharpeScore: number;      // 0-100, normalized sharpe
  sortinoScore: number;     // 0-100, normalized sortino
  drawdownScore: number;    // 0-100, lower drawdown = higher score
  /** Aktif evren (tüm fonlar veya seçili kategori) içinde portföy büyüklüğü yüzdelik dilimi */
  portfolioScaleScore?: number;
  /** Yatırımcı sayısı yüzdelik dilimi */
  investorStrengthScore?: number;
  /** ~1Y getiri (satırdaki yearlyReturn) yüzdelik dilimi */
  periodReturnScore?: number;
}

export interface FundScore {
  fundId: string;
  code: string;
  finalScore: number;       // 0-100
  riskLevel: RiskLevel;
  scores: NormalizedScores;
  metrics: FundMetrics;
  alpha: number;            // vs benchmark
  sparkline: number[];
}

export interface RankingWeights {
  return: number;
  stability: number;
  sharpe: number;
  sortino: number;
  portfolio?: number;
  investor?: number;
  /** HIGH_RETURN: referans dönem getirisi (yearlyReturn) ağırlığı */
  periodReturn?: number;
}

/**
 * Weight configurations for each ranking mode
 */
export const RANKING_WEIGHTS: Record<RankingMode, RankingWeights> = {
  /** En İyi: yıllıklandırılmış getiri + istikrar + risk-ayarlı + portföy/yatırımcı gücü */
  BEST: {
    return: 0.26,
    stability: 0.16,
    sharpe: 0.16,
    sortino: 0.1,
    portfolio: 0.16,
    investor: 0.16,
  },
  /** Düşük risk: düşük oynaklık + düşük drawdown (stability ağırlıklı) */
  LOW_RISK: {
    return: 0.06,
    stability: 0.52,
    sharpe: 0.24,
    sortino: 0.18,
  },
  /** Yüksek getiri: ~1Y getiri dilimi + yıllıklandırılmış getiri; istikrar düşük ağırlık */
  HIGH_RETURN: {
    return: 0.18,
    stability: 0.05,
    sharpe: 0.12,
    sortino: 0.1,
    periodReturn: 0.55,
  },
  /** Stabil: LOW_RISK’e yakın; biraz daha getiri payı */
  STABLE: {
    return: 0.1,
    stability: 0.58,
    sharpe: 0.18,
    sortino: 0.14,
  },
};

/**
 * Normalize a value to 0-100 scale using percentile ranking
 */
export function normalizePercentile(value: number, allValues: number[], higherIsBetter: boolean = true): number {
  if (allValues.length === 0) return 50;

  const sorted = [...allValues].sort((a, b) => a - b);
  const rank = sorted.filter((v) => v < value).length;
  const percentile = (rank / sorted.length) * 100;

  return higherIsBetter ? percentile : 100 - percentile;
}

/** Önceden sıralanmış dizi üzerinde “value”dan küçük değer sayısı (O(log n)). */
function countStrictlyLessThan(sortedAsc: number[], value: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const x = sortedAsc[mid] as number;
    if (x < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function percentileFromSortedAsc(value: number, sortedAsc: number[], higherIsBetter: boolean): number {
  if (sortedAsc.length === 0) return 50;
  if (sortedAsc.length === 1) return 50;
  const rank = countStrictlyLessThan(sortedAsc, value);
  const percentile = (rank / sortedAsc.length) * 100;
  return higherIsBetter ? percentile : 100 - percentile;
}

function safeMetricNumber(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/** Tüm fonlar için skor hesabında bir kez oluşturulur; tekrarlayan O(n log n) sıralamaları önler. */
export interface NormalizationContext {
  sortedReturns: number[];
  sortedVolatility: number[];
  sortedDrawdown: number[];
  sortedSharpe: number[];
  sortedSortino: number[];
}

export function buildNormalizationContext(allMetrics: FundMetrics[]): NormalizationContext {
  const sortAsc = (xs: number[]) => [...xs].sort((a, b) => a - b);
  return {
    sortedReturns: sortAsc(allMetrics.map((m) => safeMetricNumber(m.annualizedReturn))),
    sortedVolatility: sortAsc(allMetrics.map((m) => safeMetricNumber(m.volatility))),
    sortedDrawdown: sortAsc(allMetrics.map((m) => safeMetricNumber(m.maxDrawdown))),
    sortedSharpe: sortAsc(allMetrics.map((m) => safeMetricNumber(m.sharpeRatio))),
    sortedSortino: sortAsc(allMetrics.map((m) => safeMetricNumber(m.sortinoRatio))),
  };
}

/** Portföy / yatırımcı / ~1Y getiri yüzdelikleri için ham alanlar (snapshot veya canlı satır) */
export type FundScaleFields = {
  portfolioSize: number;
  investorCount: number;
  yearlyReturn: number;
};

export interface ExtendedNormalizationContext extends NormalizationContext {
  sortedPortfolioSize: number[];
  sortedInvestorCount: number[];
  sortedYearlyReturn: number[];
}

export function buildExtendedNormalizationContext(
  allMetrics: FundMetrics[],
  scales: FundScaleFields[]
): ExtendedNormalizationContext {
  const base = buildNormalizationContext(allMetrics);
  const sortAsc = (xs: number[]) => [...xs].sort((a, b) => a - b);
  return {
    ...base,
    sortedPortfolioSize: sortAsc(scales.map((s) => safeMetricNumber(s.portfolioSize))),
    sortedInvestorCount: sortAsc(scales.map((s) => safeMetricNumber(s.investorCount))),
    sortedYearlyReturn: sortAsc(scales.map((s) => safeMetricNumber(s.yearlyReturn))),
  };
}

export function calculateNormalizedScoresExtended(
  metrics: FundMetrics,
  ctx: ExtendedNormalizationContext,
  scale: FundScaleFields
): NormalizedScores {
  const base = calculateNormalizedScoresWithContext(metrics, ctx);
  const n = ctx.sortedPortfolioSize.length;
  if (n <= 1) {
    return {
      ...base,
      portfolioScaleScore: 50,
      investorStrengthScore: 50,
      periodReturnScore: 50,
    };
  }
  const ps = safeMetricNumber(scale.portfolioSize);
  const ic = safeMetricNumber(scale.investorCount);
  const yr = safeMetricNumber(scale.yearlyReturn);
  return {
    ...base,
    portfolioScaleScore: Math.round(percentileFromSortedAsc(ps, ctx.sortedPortfolioSize, true)),
    investorStrengthScore: Math.round(percentileFromSortedAsc(ic, ctx.sortedInvestorCount, true)),
    periodReturnScore: Math.round(percentileFromSortedAsc(yr, ctx.sortedYearlyReturn, true)),
  };
}

export function calculateNormalizedScoresWithContext(
  metrics: FundMetrics,
  ctx: NormalizationContext
): NormalizedScores {
  const ar = safeMetricNumber(metrics.annualizedReturn);
  const vol = safeMetricNumber(metrics.volatility);
  const dd = safeMetricNumber(metrics.maxDrawdown);
  const sh = safeMetricNumber(metrics.sharpeRatio);
  const so = safeMetricNumber(metrics.sortinoRatio);
  const returnScore = percentileFromSortedAsc(ar, ctx.sortedReturns, true);
  const volScore = percentileFromSortedAsc(vol, ctx.sortedVolatility, false);
  const ddScore = percentileFromSortedAsc(dd, ctx.sortedDrawdown, false);
  const riskScore = 100 - (volScore * 0.6 + ddScore * 0.4);
  const stabilityScore = volScore * 0.6 + ddScore * 0.4;
  const sharpeScore = percentileFromSortedAsc(sh, ctx.sortedSharpe, true);
  const sortinoScore = percentileFromSortedAsc(so, ctx.sortedSortino, true);
  const drawdownScore = percentileFromSortedAsc(dd, ctx.sortedDrawdown, false);

  return {
    returnScore: Math.round(returnScore),
    riskScore: Math.round(riskScore),
    stabilityScore: Math.round(stabilityScore),
    sharpeScore: Math.round(sharpeScore),
    sortinoScore: Math.round(sortinoScore),
    drawdownScore: Math.round(drawdownScore),
  };
}

/**
 * Normalize using min-max scaling with bounds
 */
export function normalizeMinMax(
  value: number, 
  min: number, 
  max: number, 
  higherIsBetter: boolean = true
): number {
  if (max === min) return 50;
  
  let normalized = ((value - min) / (max - min)) * 100;
  normalized = Math.max(0, Math.min(100, normalized));
  
  return higherIsBetter ? normalized : 100 - normalized;
}

/**
 * Calculate normalized scores from raw metrics
 */
export function calculateNormalizedScores(
  metrics: FundMetrics,
  allMetrics: FundMetrics[]
): NormalizedScores {
  return calculateNormalizedScoresWithContext(metrics, buildNormalizationContext(allMetrics));
}

/**
 * Calculate final score based on ranking mode
 */
export function calculateFinalScore(
  scores: NormalizedScores,
  mode: RankingMode
): number {
  const w = RANKING_WEIGHTS[mode];
  let s =
    w.return * scores.returnScore +
    w.stability * scores.stabilityScore +
    w.sharpe * scores.sharpeScore +
    w.sortino * scores.sortinoScore;
  const ps = scores.portfolioScaleScore ?? 50;
  const inv = scores.investorStrengthScore ?? 50;
  const pr = scores.periodReturnScore ?? 50;
  if (w.portfolio != null) s += w.portfolio * ps;
  if (w.investor != null) s += w.investor * inv;
  if (w.periodReturn != null) s += w.periodReturn * pr;
  return Math.round(Math.max(0, Math.min(100, s)));
}

/**
 * Risk level type - expanded for better granularity
 */
export type RiskLevel = "very_low" | "low" | "medium" | "high" | "very_high";

/**
 * Determine risk level based on category and fund name
 * 
 * Risk Categories:
 * - Very Low/Low (1-2): Para Piyasası, Kısa Vadeli Borçlanma, Kamu Borçlanma
 * - Medium-Low/Medium (3-4): Borçlanma Araçları, Dengeli Değişken, Katılım  
 * - Medium-High/High/Very High (5-7): Hisse Senedi Yoğun, Yabancı, Tematik, Serbest
 */
export function determineRiskLevel(
  categoryCode: string,
  fundName?: string
): RiskLevel {
  const name = (fundName || "").toUpperCase();
  
  // Very Low Risk - Para Piyasası
  if (categoryCode === "PPF" || name.includes("PARA PİYASASI") || name.includes("PARA PIYASASI")) {
    return "very_low";
  }
  
  // Low Risk - Kısa Vadeli Borçlanma, Kamu Borçlanma
  if (
    categoryCode === "BRC" ||
    name.includes("KISA VADELİ") ||
    name.includes("KISA VADELI") ||
    name.includes("TAHVİL") ||
    name.includes("TAHVIL") ||
    name.includes("BONO") ||
    name.includes("KAMU BORÇLANMA")
  ) {
    return "low";
  }
  
  // Medium Risk - Katılım, Dengeli, Değişken (non-aggressive)
  if (
    categoryCode === "KTL" ||
    categoryCode === "KRM" ||
    name.includes("KATILIM") ||
    name.includes("DENGELİ") ||
    name.includes("DENGELI")
  ) {
    return "medium";
  }
  
  // High Risk - Hisse Senedi Fonları
  if (
    categoryCode === "HSF" ||
    name.includes("HİSSE SENEDİ") ||
    name.includes("HISSE SENEDI")
  ) {
    // Check if it's "Hisse Senedi Yoğun" which is very high risk
    if (name.includes("YOĞUN") || name.includes("YOGUN")) {
      return "very_high";
    }
    return "high";
  }
  
  // Very High Risk - Serbest, Yabancı, Tematik, Değişken aggressive
  if (
    categoryCode === "SRB" ||
    categoryCode === "DGS" ||
    name.includes("SERBEST") ||
    name.includes("YABANCI") ||
    name.includes("TEMATİK") ||
    name.includes("TEMATIK") ||
    name.includes("EMTİA") ||
    name.includes("EMTIA")
  ) {
    return "very_high";
  }
  
  // Altın - Medium-High Risk
  if (categoryCode === "ALT" || name.includes("ALTIN") || name.includes("GOLD")) {
    return "high";
  }
  
  // Fon Sepeti - depends on composition, default to medium
  if (categoryCode === "FSP" || name.includes("FON SEPETİ") || name.includes("FON SEPETI")) {
    return "medium";
  }
  
  // Default based on volatility scores if available
  return "medium";
}

/**
 * Get risk level display info
 */
export function getRiskLevelInfo(level: RiskLevel): { 
  label: string; 
  labelShort: string;
  color: string; 
  bg: string; 
  border: string;
  numericLevel: number;
} {
  switch (level) {
    case "very_low":
      return {
        label: "Çok Düşük",
        labelShort: "Çok Düşük",
        color: "rgb(16, 185, 129)",
        bg: "rgba(16, 185, 129, 0.065)",
        border: "rgba(16, 185, 129, 0.14)",
        numericLevel: 1,
      };
    case "low":
      return {
        label: "Düşük",
        labelShort: "Düşük",
        color: "rgb(34, 197, 94)",
        bg: "rgba(34, 197, 94, 0.065)",
        border: "rgba(34, 197, 94, 0.14)",
        numericLevel: 2,
      };
    case "medium":
      return {
        label: "Orta",
        labelShort: "Orta",
        color: "rgb(245, 158, 11)",
        bg: "rgba(245, 158, 11, 0.065)",
        border: "rgba(245, 158, 11, 0.14)",
        numericLevel: 4,
      };
    case "high":
      return {
        label: "Yüksek",
        labelShort: "Yüksek",
        color: "rgb(249, 115, 22)",
        bg: "rgba(249, 115, 22, 0.065)",
        border: "rgba(249, 115, 22, 0.14)",
        numericLevel: 5,
      };
    case "very_high":
      return {
        label: "Çok Yüksek",
        labelShort: "Çok Yüksek",
        color: "rgb(239, 68, 68)",
        bg: "rgba(239, 68, 68, 0.065)",
        border: "rgba(239, 68, 68, 0.14)",
        numericLevel: 7,
      };
  }
}

/**
 * Rank funds by final score
 */
export function rankFunds(fundScores: FundScore[], mode: RankingMode): FundScore[] {
  // Recalculate final scores for the mode
  const reranked = fundScores.map(fund => ({
    ...fund,
    finalScore: calculateFinalScore(fund.scores, mode),
  }));
  
  // Sort by final score descending
  return reranked.sort((a, b) => b.finalScore - a.finalScore);
}

/**
 * Get score color based on value
 */
export function getScoreColor(score: number): string {
  if (score >= 75) return "var(--success)";
  if (score >= 50) return "var(--accent)";
  if (score >= 25) return "var(--warning, #f59e0b)";
  return "var(--text-muted)";
}

/**
 * Get risk badge color
 */
export function getRiskBadgeStyle(level: "low" | "medium" | "high"): { bg: string; color: string; border: string } {
  switch (level) {
    case "low":
      return { 
        bg: "rgba(16, 185, 129, 0.1)", 
        color: "rgb(16, 185, 129)", 
        border: "rgba(16, 185, 129, 0.2)" 
      };
    case "medium":
      return { 
        bg: "rgba(245, 158, 11, 0.1)", 
        color: "rgb(245, 158, 11)", 
        border: "rgba(245, 158, 11, 0.2)" 
      };
    case "high":
      return { 
        bg: "rgba(239, 68, 68, 0.1)", 
        color: "rgb(239, 68, 68)", 
        border: "rgba(239, 68, 68, 0.2)" 
      };
  }
}

/**
 * Format score display
 */
export function formatScore(score: number): string {
  return score.toFixed(0);
}

/**
 * Format percentage display
 */
export function formatPercent(value: number, decimals: number = 2): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

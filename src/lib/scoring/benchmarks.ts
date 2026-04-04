/**
 * Benchmark system for alpha calculation
 */

export interface Benchmark {
  code: string;
  name: string;
  annualizedReturn: number; // Will be fetched/updated
}

/**
 * Category to benchmark mapping
 */
export const CATEGORY_BENCHMARKS: Record<string, string> = {
  // Hisse Senedi fonları -> BIST100
  HSF: "BIST100",
  
  // Altın fonları -> Gold
  ALT: "GOLD",
  
  // Para Piyasası -> TLREF (interbank rate proxy)
  PPF: "TLREF",
  
  // Borçlanma Araçları -> Government Bond
  BRC: "GOVBOND",
  
  // Serbest fonlar -> BIST100 (general market)
  SRB: "BIST100",
  
  // Katılım fonları -> Participation Index
  KTL: "KATLM",
  
  // Fon Sepeti -> Blended
  FSP: "BLEND",
  
  // Karma fonlar -> Blended
  KRM: "BLEND",
  
  // Değişken fonlar -> BIST100
  DGS: "BIST100",
  
  // Diğer -> BIST100
  DGR: "BIST100",
};

/**
 * Default benchmark returns (annualized %)
 * These should be updated from actual data
 */
export const BENCHMARK_RETURNS: Record<string, number> = {
  BIST100: 45.0,    // ~45% annual return (volatile market)
  GOLD: 38.0,       // Gold in TRY terms
  TLREF: 42.0,      // ~42% (high interest rate environment)
  GOVBOND: 35.0,    // Government bonds
  KATLM: 40.0,      // Participation index
  BLEND: 38.0,      // Blended average
};

/**
 * Get benchmark for a category
 */
export function getBenchmarkForCategory(categoryCode: string): string {
  return CATEGORY_BENCHMARKS[categoryCode] || "BIST100";
}

/**
 * Get benchmark return
 */
export function getBenchmarkReturn(benchmarkCode: string): number {
  return BENCHMARK_RETURNS[benchmarkCode] ?? 40.0;
}

/**
 * Calculate alpha (excess return over benchmark)
 */
export function calculateAlpha(fundReturn: number, categoryCode: string): number {
  const benchmark = getBenchmarkForCategory(categoryCode);
  const benchmarkReturn = getBenchmarkReturn(benchmark);
  return fundReturn - benchmarkReturn;
}

/**
 * Get benchmark name for display
 */
export function getBenchmarkName(benchmarkCode: string): string {
  const names: Record<string, string> = {
    BIST100: "BIST 100",
    GOLD: "Altın (TRY)",
    TLREF: "TLREF",
    GOVBOND: "Devlet Tahvili",
    KATLM: "Katılım Endeksi",
    BLEND: "Karma Endeks",
  };
  return names[benchmarkCode] || benchmarkCode;
}

/**
 * Determine if alpha is significant
 */
export function isAlphaSignificant(alpha: number): boolean {
  return Math.abs(alpha) > 2.0; // More than 2% difference
}

/**
 * Get alpha color
 */
export function getAlphaColor(alpha: number): string {
  if (alpha > 5) return "var(--success)";
  if (alpha > 0) return "rgb(16, 185, 129, 0.7)";
  if (alpha > -5) return "rgb(245, 158, 11, 0.8)";
  return "var(--danger)";
}

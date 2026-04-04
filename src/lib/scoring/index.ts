/**
 * Fund Scoring System
 * 
 * Provides intelligent fund ranking based on:
 * - Return metrics (total, annualized)
 * - Risk metrics (volatility, drawdown)
 * - Risk-adjusted metrics (Sharpe, Sortino, Calmar)
 * - Benchmark comparison (alpha)
 */

export * from "./metrics";
export * from "./ranking";
export * from "./benchmarks";

export { RANKING_WEIGHTS, type RiskLevel } from "./ranking";
export { CATEGORY_BENCHMARKS, BENCHMARK_RETURNS } from "./benchmarks";

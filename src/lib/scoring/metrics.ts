/**
 * Core financial metrics calculation
 * All functions handle edge cases gracefully
 */

export interface PricePoint {
  date: Date;
  price: number;
}

export interface FundMetrics {
  totalReturn: number;
  annualizedReturn: number;
  volatility: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  winRate: number;
  avgGain: number;
  avgLoss: number;
  dataPoints: number;
}

/** Özet satırı olmayan fonlar için skor sıralaması (nötr karşılaştırma). */
export const EMPTY_FUND_METRICS: FundMetrics = {
  totalReturn: 0,
  annualizedReturn: 0,
  volatility: 0,
  maxDrawdown: 0,
  sharpeRatio: 0,
  sortinoRatio: 0,
  calmarRatio: 0,
  winRate: 0,
  avgGain: 0,
  avgLoss: 0,
  dataPoints: 0,
};

const TRADING_DAYS_PER_YEAR = 252;
const RISK_FREE_RATE = 0; // Can be adjusted later

/**
 * Calculate daily returns from price series
 */
export function calculateDailyReturns(prices: number[]): number[] {
  if (prices.length < 2) return [];
  
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (prev !== undefined && curr !== undefined && prev > 0) {
      returns.push((curr - prev) / prev);
    }
  }
  return returns;
}

/**
 * Calculate total return over the period
 */
export function calculateTotalReturn(prices: number[]): number {
  if (prices.length < 2) return 0;
  const first = prices[0];
  const last = prices.at(-1);
  if (first === undefined || last === undefined || first <= 0) return 0;
  return ((last - first) / first) * 100;
}

/**
 * Calculate annualized return
 */
export function calculateAnnualizedReturn(totalReturn: number, days: number): number {
  if (days <= 0) return 0;
  const years = days / TRADING_DAYS_PER_YEAR;
  if (years <= 0) return totalReturn;
  
  const decimalReturn = totalReturn / 100;
  const annualized = Math.pow(1 + decimalReturn, 1 / years) - 1;
  return annualized * 100;
}

/**
 * Calculate annualized volatility (standard deviation of returns)
 */
export function calculateVolatility(returns: number[]): number {
  if (returns.length < 2) return 0;
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (returns.length - 1);
  const dailyVol = Math.sqrt(variance);
  
  // Annualize
  return dailyVol * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;
}

/**
 * Calculate maximum drawdown
 */
export function calculateMaxDrawdown(prices: number[]): number {
  if (prices.length < 2) return 0;

  const first = prices[0];
  if (first === undefined || first <= 0) return 0;

  let maxDrawdown = 0;
  let peak = first;

  for (const price of prices) {
    if (price > peak) {
      peak = price;
    }
    const drawdown = (peak - price) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  
  return maxDrawdown * 100;
}

/**
 * Calculate Sharpe Ratio
 * (Return - RiskFreeRate) / Volatility
 */
export function calculateSharpeRatio(annualizedReturn: number, volatility: number): number {
  if (volatility <= 0) return 0;
  return (annualizedReturn - RISK_FREE_RATE) / volatility;
}

/**
 * Calculate Sortino Ratio
 * Uses downside deviation instead of total volatility
 */
export function calculateSortinoRatio(returns: number[], annualizedReturn: number): number {
  if (returns.length < 2) return 0;
  
  // Calculate downside deviation (only negative returns)
  const negativeReturns = returns.filter(r => r < 0);
  if (negativeReturns.length === 0) return annualizedReturn > 0 ? 10 : 0; // Cap at 10 if no downside
  
  const squaredNegative = negativeReturns.map(r => r * r);
  const downsideVariance = squaredNegative.reduce((a, b) => a + b, 0) / returns.length;
  const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;
  
  if (downsideDeviation <= 0) return 0;
  return (annualizedReturn - RISK_FREE_RATE) / downsideDeviation;
}

/**
 * Calculate Calmar Ratio
 * Annualized Return / Max Drawdown
 */
export function calculateCalmarRatio(annualizedReturn: number, maxDrawdown: number): number {
  if (maxDrawdown <= 0) return annualizedReturn > 0 ? 10 : 0;
  return annualizedReturn / maxDrawdown;
}

/**
 * Calculate win rate and average gain/loss
 */
export function calculateWinMetrics(returns: number[]): { winRate: number; avgGain: number; avgLoss: number } {
  if (returns.length === 0) return { winRate: 0, avgGain: 0, avgLoss: 0 };
  
  const gains = returns.filter(r => r > 0);
  const losses = returns.filter(r => r < 0);
  
  const winRate = (gains.length / returns.length) * 100;
  const avgGain = gains.length > 0 ? (gains.reduce((a, b) => a + b, 0) / gains.length) * 100 : 0;
  const avgLoss = losses.length > 0 ? (losses.reduce((a, b) => a + b, 0) / losses.length) * 100 : 0;
  
  return { winRate, avgGain, avgLoss };
}

/**
 * Calculate all metrics for a fund
 */
export function calculateAllMetrics(priceHistory: PricePoint[]): FundMetrics {
  // Sort by date ascending
  const sorted = [...priceHistory].sort((a, b) => a.date.getTime() - b.date.getTime());
  const prices = sorted.map(p => p.price).filter(p => p > 0);
  
  if (prices.length < 2) {
    return {
      totalReturn: 0,
      annualizedReturn: 0,
      volatility: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      winRate: 0,
      avgGain: 0,
      avgLoss: 0,
      dataPoints: prices.length,
    };
  }
  
  const returns = calculateDailyReturns(prices);
  const totalReturn = calculateTotalReturn(prices);
  const annualizedReturn = calculateAnnualizedReturn(totalReturn, prices.length);
  const volatility = calculateVolatility(returns);
  const maxDrawdown = calculateMaxDrawdown(prices);
  const sharpeRatio = calculateSharpeRatio(annualizedReturn, volatility);
  const sortinoRatio = calculateSortinoRatio(returns, annualizedReturn);
  const calmarRatio = calculateCalmarRatio(annualizedReturn, maxDrawdown);
  const winMetrics = calculateWinMetrics(returns);
  
  return {
    totalReturn,
    annualizedReturn,
    volatility,
    maxDrawdown,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    ...winMetrics,
    dataPoints: prices.length,
  };
}

/**
 * Generate simple sparkline data points
 * Normalizes prices to 0-100 scale for visualization
 */
export function generateSparklineData(prices: number[], points: number = 20): number[] {
  if (prices.length === 0) return [];
  if (prices.length <= points) {
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    return prices.map(p => ((p - min) / range) * 100);
  }
  
  // Sample evenly
  const step = (prices.length - 1) / (points - 1);
  const sampled: number[] = [];
  for (let i = 0; i < points; i++) {
    const idx = Math.min(prices.length - 1, Math.max(0, Math.round(i * step)));
    const v = prices[idx];
    if (v !== undefined) sampled.push(v);
  }
  
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const range = max - min || 1;
  return sampled.map(p => ((p - min) / range) * 100);
}

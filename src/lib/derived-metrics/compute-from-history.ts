/**
 * Günlük job: sıkıştırılmış seans serisi → türetilmiş getiri / vol / drawdown alanları.
 * İstek yolunda çağrılmaz.
 */

import { calculateAllMetrics, type PricePoint } from "@/lib/scoring";

const DAY_MS = 24 * 60 * 60 * 1000;
const SPARKLINE_POINTS = 7;

export type DerivedSeriesCompute = {
  latestPrice: number;
  return1d: number;
  return7d: number | null;
  return30d: number | null;
  return90d: number | null;
  return180d: number | null;
  return1y: number | null;
  return2y: number | null;
  volatility1y: number | null;
  volatility2y: number | null;
  maxDrawdown1y: number | null;
  maxDrawdown2y: number | null;
  annualizedReturn1y: number;
  sharpe1y: number;
  sortino1y: number;
  totalReturn2y: number | null;
  historySessions: number;
  sparklinePrices: number[];
};

function clampReturn(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > 1000) return 0;
  return Number(value.toFixed(4));
}

function pctChange(prev: number, current: number): number {
  if (!Number.isFinite(prev) || !Number.isFinite(current) || prev <= 0) return 0;
  return ((current - prev) / prev) * 100;
}

function findClosestPointOnOrBefore(points: PricePoint[], targetDate: Date): PricePoint | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i];
    if (point && point.date.getTime() <= targetDate.getTime()) return point;
  }
  return null;
}

function sliceFromDateInclusive(points: PricePoint[], start: Date): PricePoint[] {
  const t = start.getTime();
  return points.filter((p) => p.date.getTime() >= t);
}

function emptyDerived(): DerivedSeriesCompute {
  return {
    latestPrice: 0,
    return1d: 0,
    return7d: null,
    return30d: null,
    return90d: null,
    return180d: null,
    return1y: null,
    return2y: null,
    volatility1y: null,
    volatility2y: null,
    maxDrawdown1y: null,
    maxDrawdown2y: null,
    annualizedReturn1y: 0,
    sharpe1y: 0,
    sortino1y: 0,
    totalReturn2y: null,
    historySessions: 0,
    sparklinePrices: [],
  };
}

/**
 * `pricePoints`: artan tarih, pozitif fiyat, mümkünse compress+dedupe sonrası.
 */
export function computeDerivedFromPricePoints(pricePoints: PricePoint[]): DerivedSeriesCompute {
  if (pricePoints.length === 0) return emptyDerived();

  const latest = pricePoints[pricePoints.length - 1]!;
  if (!Number.isFinite(latest.price) || latest.price <= 0) return emptyDerived();

  const previous = pricePoints.length >= 2 ? pricePoints[pricePoints.length - 2]! : null;
  const currentDate = latest.date;

  const horizonReturn = (days: number): number | null => {
    const base = findClosestPointOnOrBefore(
      pricePoints,
      new Date(currentDate.getTime() - days * DAY_MS)
    );
    if (!base || !Number.isFinite(base.price) || base.price <= 0) return null;
    return clampReturn(pctChange(base.price, latest.price));
  };

  const slice1y = sliceFromDateInclusive(
    pricePoints,
    new Date(currentDate.getTime() - 365 * DAY_MS)
  );
  const slice2y = sliceFromDateInclusive(
    pricePoints,
    new Date(currentDate.getTime() - 730 * DAY_MS)
  );

  const metrics1y = slice1y.length >= 2 ? calculateAllMetrics(slice1y) : null;
  const metrics2y = slice2y.length >= 2 ? calculateAllMetrics(slice2y) : null;

  const return1d = previous
    ? clampReturn(pctChange(previous.price, latest.price))
    : 0;

  const sparklinePrices = pricePoints.slice(-SPARKLINE_POINTS).map((p) => p.price);

  return {
    latestPrice: latest.price,
    return1d,
    return7d: horizonReturn(7),
    return30d: horizonReturn(30),
    return90d: horizonReturn(90),
    return180d: horizonReturn(180),
    return1y: horizonReturn(365),
    return2y: horizonReturn(730),
    volatility1y: metrics1y ? metrics1y.volatility : null,
    volatility2y: metrics2y ? metrics2y.volatility : null,
    maxDrawdown1y: metrics1y ? metrics1y.maxDrawdown : null,
    maxDrawdown2y: metrics2y ? metrics2y.maxDrawdown : null,
    annualizedReturn1y: metrics1y?.annualizedReturn ?? 0,
    sharpe1y: metrics1y?.sharpeRatio ?? 0,
    sortino1y: metrics1y?.sortinoRatio ?? 0,
    totalReturn2y: metrics2y?.totalReturn ?? null,
    historySessions: pricePoints.length,
    sparklinePrices,
  };
}

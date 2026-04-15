import test from "node:test";
import assert from "node:assert/strict";
import { buildCategorySeriesFromServingPayloads } from "@/lib/compare-series-category";
import type { FundDetailCoreServingPayload } from "@/lib/services/fund-detail-core-serving.service";

function payload(code: string, categoryCode: string, prices: number[]): FundDetailCoreServingPayload {
  const start = Date.UTC(2026, 0, 1);
  return {
    version: 1,
    generatedAt: new Date(start).toISOString(),
    sourceDate: new Date(start).toISOString(),
    fund: {
      fundId: code,
      code,
      name: `${code} fon`,
      shortName: null,
      logoUrl: null,
      categoryCode,
      categoryName: "Kategori",
      fundTypeCode: null,
      fundTypeName: null,
    },
    latestSnapshotDate: new Date(start + (prices.length - 1) * 86_400_000).toISOString(),
    latestPrice: prices[prices.length - 1] ?? 1,
    dailyChangePct: 0,
    monthlyReturn: 0,
    yearlyReturn: 0,
    snapshotAlpha: null,
    riskLevel: null,
    snapshotMetrics: {},
    miniPriceSeries: [],
    chartHistory: {
      mode: "history",
      lookbackDays: 30,
      minDate: new Date(start).toISOString(),
      maxDate: new Date(start + (prices.length - 1) * 86_400_000).toISOString(),
      points: prices.map((p, index) => ({ t: start + index * 86_400_000, p, d: null, i: null, s: null })),
    },
    investorSummary: { current: 0, delta: null, min: null, max: null, series: [] },
    portfolioSummary: { current: 0, delta: null, min: null, max: null, series: [] },
  };
}

test("compare-series category reference can be built with only the base fund selected", () => {
  const base = payload("VGA", "ALT", [100, 101, 102]);
  const category = buildCategorySeriesFromServingPayloads(base, [
    base,
    payload("ALT1", "ALT", [100, 102, 104]),
    payload("ALT2", "ALT", [100, 101, 103]),
    payload("PPF1", "PPF", [100, 100, 100]),
  ]);

  assert.ok(category.length >= 2);
  assert.equal(category[0]!.v > 0, true);
  assert.equal(category.every((point) => Number.isFinite(point.t) && Number.isFinite(point.v)), true);
});

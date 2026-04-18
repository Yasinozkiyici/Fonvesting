import test from "node:test";
import assert from "node:assert/strict";
import { normalizeServingDetailPayload, toServingDetailMap } from "@/lib/data-platform/compare-series-serving";

test("normalizeServingDetailPayload parses minimal valid serving detail payload", () => {
  const payload = normalizeServingDetailPayload({
    version: 1,
    generatedAt: "2026-04-17T00:00:00.000Z",
    sourceDate: "2026-04-16T00:00:00.000Z",
    fund: {
      fundId: "f1",
      code: "VGA",
      name: "VGA Fon",
      shortName: "VGA",
      logoUrl: null,
      categoryCode: "ALT",
      categoryName: "Altın",
      fundTypeCode: 7,
      fundTypeName: "Serbest",
    },
    latestSnapshotDate: "2026-04-16T00:00:00.000Z",
    latestPrice: 12.3,
    dailyChangePct: 0.5,
    monthlyReturn: 1.2,
    yearlyReturn: 9.1,
    snapshotMetrics: {},
    chartHistory: {
      mode: "history",
      lookbackDays: 365,
      minDate: "2025-04-16T00:00:00.000Z",
      maxDate: "2026-04-16T00:00:00.000Z",
      points: [{ t: 1_700_000_000_000, p: 10.2 }],
    },
    investorSummary: { current: 1200 },
    portfolioSummary: { current: 5500000 },
  });
  assert.ok(payload);
  assert.equal(payload?.fund.code, "VGA");
  assert.equal(payload?.chartHistory.points.length, 1);
});

test("normalizeServingDetailPayload rejects malformed payload", () => {
  const payload = normalizeServingDetailPayload({ fund: { code: "VGA" } });
  assert.equal(payload, null);
});

test("toServingDetailMap keeps only valid rows", () => {
  const rows = [
    {
      fundCode: "VGA",
      payload: {
        version: 1,
        generatedAt: "2026-04-17T00:00:00.000Z",
        sourceDate: "2026-04-16T00:00:00.000Z",
        fund: { code: "VGA", name: "VGA" },
        chartHistory: { points: [] },
      },
    },
    { fundCode: "BAD", payload: { foo: "bar" } },
  ];
  const map = toServingDetailMap(rows);
  assert.equal(map.size, 1);
  assert.equal(map.has("VGA"), true);
  assert.equal(map.has("BAD"), false);
});


import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCompareApiBoundary, resolveCompareSurfaceState } from "@/lib/data-flow/compare-boundary";

test("compare boundary returns degraded_insufficient_funds for single code", () => {
  const out = normalizeCompareApiBoundary({
    requestedCodes: ["AAA"],
    body: { funds: [], compare: null, meta: {} },
  });
  assert.equal(out.surfaceState.kind, "degraded_insufficient_funds");
});

test("compare boundary does not pretend success with insufficient rows", () => {
  const out = normalizeCompareApiBoundary({
    requestedCodes: ["AAA", "BBB"],
    body: {
      funds: [{ code: "AAA", name: "A", lastPrice: 1, dailyReturn: 0, monthlyReturn: 0, yearlyReturn: 0, portfolioSize: 0, investorCount: 0, shortName: null, category: null, fundType: null, volatility1y: null, maxDrawdown1y: null, variabilityLabel: null }],
      compare: null,
      meta: {},
    },
  });
  assert.equal(out.surfaceState.kind, "degraded_insufficient_funds");
});

test("compare boundary maps timeout to typed degraded state", () => {
  const state = resolveCompareSurfaceState({
    requestedCount: 2,
    returnedCount: 2,
    failureClass: "timeout",
    degradedSource: "serving_exception_fallback",
    payloadInvalid: false,
  });
  assert.equal(state.kind, "degraded_timeout");
});

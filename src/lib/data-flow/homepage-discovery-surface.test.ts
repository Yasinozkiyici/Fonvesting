import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveHomepageDiscoveryTableSurfaceState,
  resolveHomepageRegisteredTotal,
} from "./homepage-discovery-surface";
import type { ScoredResponse } from "@/types/scored-funds";

function makePayload(universeTotal: number, matchedTotal: number, rows: number): ScoredResponse {
  return {
    mode: "BEST",
    total: universeTotal,
    universeTotal,
    matchedTotal,
    returnedCount: rows,
    funds: Array.from({ length: rows }, (_, i) => ({
      fundId: `f-${i}`,
      code: `C${i}`,
      name: `N${i}`,
      shortName: null,
      logoUrl: null,
      lastPrice: 1,
      dailyReturn: 0,
      portfolioSize: 1,
      investorCount: 0,
      category: null,
      fundType: null,
      finalScore: null,
    })),
  };
}

test("resolveHomepageRegisteredTotal: filtresiz durumda sadece canonical total kullanır", () => {
  const r = resolveHomepageRegisteredTotal({
    hasFilters: false,
    canonicalUniverseTotal: 2390,
    scopedPayload: makePayload(180, 180, 180),
  });
  assert.equal(r, 2390);
});

test("resolveHomepageRegisteredTotal: filtreli durumda yalnız matchedTotal kullanır", () => {
  const r = resolveHomepageRegisteredTotal({
    hasFilters: true,
    canonicalUniverseTotal: 2390,
    scopedPayload: makePayload(2390, 12, 10),
  });
  assert.equal(r, 12);
});

test("resolveHomepageRegisteredTotal: filtreli ve scoped payload yoksa null döner", () => {
  const r = resolveHomepageRegisteredTotal({
    hasFilters: true,
    canonicalUniverseTotal: 2390,
    scopedPayload: null,
  });
  assert.equal(r, null);
});

test("deriveHomepageDiscoveryTableSurfaceState: degraded empty typed reason ile döner", () => {
  const state = deriveHomepageDiscoveryTableSurfaceState({
    loading: false,
    bootstrapFallbackActive: false,
    error: null,
    paginatedCount: 0,
    hasFilters: false,
    scoresMeta: { degraded: "1", emptyResult: "degraded" },
  });
  assert.equal(state.kind, "degraded_empty");
});


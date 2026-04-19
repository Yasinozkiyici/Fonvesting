import test from "node:test";
import assert from "node:assert/strict";
import { deriveDiscoverySurfaceState } from "@/lib/contracts/discovery-surface-state";
import { deriveSpotlightContract } from "@/lib/contracts/spotlight-contract";
import { buildDiscoveryPayloadContract } from "@/lib/contracts/discovery-payload-contract";
import { resolveHomepageTableSeedPayload } from "@/lib/data-flow/homepage-discovery-surface";
import type { ScoredResponse } from "@/types/scored-funds";

test("discovery surface distinguishes loading_initial vs loading_refresh", () => {
  const initial = deriveDiscoverySurfaceState({
    loading: true,
    error: false,
    hasRenderableRows: false,
    surfaceState: null,
    degradedHeader: false,
  });
  const refresh = deriveDiscoverySurfaceState({
    loading: true,
    error: false,
    hasRenderableRows: true,
    surfaceState: "ready",
    degradedHeader: false,
  });
  assert.equal(initial, "loading_initial");
  assert.equal(refresh, "loading_refresh");
});

test("degraded scoped payload never collapses to empty_scoped", () => {
  const degraded = deriveDiscoverySurfaceState({
    loading: false,
    error: false,
    hasRenderableRows: false,
    surfaceState: "degraded_empty",
    degradedHeader: true,
  });
  assert.equal(degraded, "degraded_scoped");
});

test("home discovery seed keeps meaningful SSR payload", () => {
  const preview: ScoredResponse = {
    mode: "BEST",
    total: 10,
    universeTotal: 10,
    matchedTotal: 10,
    returnedCount: 1,
    funds: [
      {
        fundId: "1",
        code: "AAA",
        name: "A",
        shortName: null,
        logoUrl: null,
        lastPrice: 1,
        dailyReturn: 0,
        portfolioSize: 1,
        investorCount: 1,
        category: null,
        fundType: null,
        finalScore: 1,
      },
    ],
  };
  assert.equal(resolveHomepageTableSeedPayload({ initialScoresPreview: preview }), preview);
});

test("spotlight zero states are explicit and contract-backed", () => {
  const contractMatches = buildDiscoveryPayloadContract({
    payload: {
      mode: "BEST",
      total: 20,
      universeTotal: 20,
      matchedTotal: 4,
      returnedCount: 4,
      funds: [],
    },
    scope: { mode: "BEST", categoryCode: "", theme: null, queryTrim: "", limit: null },
    scopeHealth: "healthy",
    discoverySource: "test",
    trustAsFinal: true,
    degradedReason: null,
  });
  const rankingUnavailable = deriveSpotlightContract({
    discoveryActive: true,
    discoverySurface: "ready",
    discoveryContract: contractMatches,
    spotlightFunds: [],
  });
  assert.equal(rankingUnavailable.reason, "ranking_unavailable");

  const noMatchesContract = buildDiscoveryPayloadContract({
    payload: {
      mode: "BEST",
      total: 20,
      universeTotal: 20,
      matchedTotal: 0,
      returnedCount: 0,
      funds: [],
    },
    scope: { mode: "BEST", categoryCode: "", theme: null, queryTrim: "", limit: null },
    scopeHealth: "healthy",
    discoverySource: "test",
    trustAsFinal: true,
    degradedReason: null,
  });
  const noMatch = deriveSpotlightContract({
    discoveryActive: true,
    discoverySurface: "empty_scoped",
    discoveryContract: noMatchesContract,
    spotlightFunds: [],
  });
  assert.equal(noMatch.reason, "no_scope_matches");

  const sourceUnavailable = deriveSpotlightContract({
    discoveryActive: true,
    discoverySurface: "ready",
    discoveryContract: null,
    spotlightFunds: [],
  });
  assert.equal(sourceUnavailable.reason, "source_unavailable");
});

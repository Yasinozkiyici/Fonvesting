import test from "node:test";
import assert from "node:assert/strict";
import { buildDiscoveryPayloadContract, isDiscoveryPayloadContract } from "@/lib/contracts/discovery-payload-contract";
import { deriveSpotlightContract } from "@/lib/contracts/spotlight-contract";
import { deriveComparisonRenderContract } from "@/lib/contracts/comparison-render-contract";
import { normalizeScoredResponse } from "@/lib/client-data";
import type { ScoresApiPayload } from "@/lib/services/fund-scores-types";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

test("buildDiscoveryPayloadContract is the only totals owner when meta.discovery present", () => {
  const payload: ScoresApiPayload = {
    mode: "BEST",
    total: 100,
    universeTotal: 100,
    matchedTotal: 12,
    returnedCount: 10,
    funds: [],
  };
  const contract = buildDiscoveryPayloadContract({
    payload,
    scope: {
      mode: "BEST",
      categoryCode: "",
      theme: null,
      queryTrim: "",
      limit: 150,
    },
    scopeHealth: "healthy",
    discoverySource: "test",
    trustAsFinal: true,
    degradedReason: null,
  });
  const body = {
    ...payload,
    funds: [],
    meta: {
      surfaceState: "ready" as const,
      freshness: { state: "fresh" as const, asOf: null, ageMs: null, reason: "asof_unknown" as const },
      canonicalFreshness: null,
      discovery: contract,
    },
  };
  const normalized = normalizeScoredResponse(body);
  assert.ok(normalized);
  assert.equal(normalized.matchedTotal, 12);
  assert.equal(normalized.universeTotal, 100);
  assert.ok(normalized.discoveryContract);
  assert.equal(normalized.discoveryContract.matchedTotal, 12);
});

test("normalizeScoredResponse does not apply legacy matchedTotal heuristics when discovery contract exists", () => {
  const contract = buildDiscoveryPayloadContract({
    payload: {
      mode: "BEST",
      total: 50,
      universeTotal: 50,
      matchedTotal: 5,
      returnedCount: 5,
      funds: [],
    },
    scope: { mode: "BEST", categoryCode: "", theme: null, queryTrim: "", limit: null },
    scopeHealth: "healthy",
    discoverySource: "test",
    trustAsFinal: true,
    degradedReason: null,
  });
  const normalized = normalizeScoredResponse({
    mode: "BEST",
    total: 999,
    universeTotal: 999,
    matchedTotal: 1,
    returnedCount: 5,
    funds: [],
    meta: {
      discovery: contract,
      surfaceState: "ready",
      freshness: { state: "fresh", asOf: null, ageMs: null, reason: "asof_unknown" },
    },
  });
  assert.ok(normalized);
  assert.equal(normalized.matchedTotal, 5);
  assert.equal(normalized.universeTotal, 50);
});

test("isDiscoveryPayloadContract rejects partial objects", () => {
  assert.equal(isDiscoveryPayloadContract({ universeTotal: 1 }), false);
  assert.equal(
    isDiscoveryPayloadContract({
      universeTotal: 1,
      matchedTotal: 1,
      returnedCount: 0,
      scopeAlignment: "aligned",
      sourceQuality: "fallback",
      degradedReason: null,
      discoverySource: "x",
      scope: { mode: "BEST", categoryCode: "", theme: null, queryTrim: "", limit: null },
    }),
    true
  );
});

test("deriveSpotlightContract marks renderable only when discovery + rows align", () => {
  const contract = buildDiscoveryPayloadContract({
    payload: {
      mode: "BEST",
      total: 10,
      universeTotal: 10,
      matchedTotal: 3,
      returnedCount: 3,
      funds: [],
    },
    scope: { mode: "BEST", categoryCode: "", theme: null, queryTrim: "", limit: null },
    scopeHealth: "healthy",
    discoverySource: "test",
    trustAsFinal: true,
    degradedReason: null,
  });
  const ready = deriveSpotlightContract({
    discoveryActive: true,
    discoverySurface: "ready",
    discoveryContract: contract,
    spotlightFunds: [{ code: "A" } as never, { code: "B" } as never],
  });
  assert.equal(ready.renderable, true);
  assert.equal(ready.reason, "spotlight_ready");

  const empty = deriveSpotlightContract({
    discoveryActive: true,
    discoverySurface: "ready",
    discoveryContract: contract,
    spotlightFunds: [],
  });
  assert.equal(empty.renderable, false);
  assert.equal(empty.reason, "ranking_unavailable");
});

test("deriveComparisonRenderContract matches kiyas rows only", () => {
  const minimal: FundDetailPageData = {
    fund: {} as FundDetailPageData["fund"],
    snapshotDate: null,
    snapshotAlpha: null,
    riskLevel: null,
    snapshotMetrics: null,
    priceSeries: [],
    historyMetrics: null,
    bestWorstDay: null,
    modelBenchmark: null,
    tradingCurrency: "TRY",
    derivedSummary: {} as FundDetailPageData["derivedSummary"],
    similarFunds: [],
    similarCategoryPeerDailyReturns: [],
    categoryReturnAverages: null,
    kiyasBlock: {
      refs: [{ key: "category", label: "Kategori" }],
      defaultRef: "category",
      rowsByRef: {
        category: [{ periodId: "1y", fundPct: 1, refPct: 1, refPolicyDeltaPp: null, band: null, diffPct: null }],
      },
      summaryByRef: {},
      chartMacroByRef: {},
      categoryReturnSlice: null,
      chartSummaryByRef: {},
    },
    trendSeries: { portfolioSize: [], investorCount: [] },
  };
  const c = deriveComparisonRenderContract(minimal);
  assert.equal(c.renderable, true);
  assert.equal(c.validRefs, 1);
});

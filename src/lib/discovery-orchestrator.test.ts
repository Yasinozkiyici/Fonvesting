import test from "node:test";
import assert from "node:assert/strict";
import { deriveDiscoveryHealth } from "@/lib/discovery-orchestrator";
import type { ScoresApiPayload } from "@/lib/services/fund-scores-types";

const basePayload: ScoresApiPayload = {
  mode: "BEST",
  total: 2,
  universeTotal: 2,
  matchedTotal: 2,
  returnedCount: 2,
  funds: [
    {
      fundId: "1",
      code: "AAA",
      name: "AAA Fon",
      shortName: null,
      logoUrl: null,
      lastPrice: 1,
      dailyReturn: 0.2,
      portfolioSize: 100,
      investorCount: 10,
      category: { code: "CAT", name: "Kategori" },
      fundType: null,
      finalScore: 10,
    },
    {
      fundId: "2",
      code: "BBB",
      name: "BBB Fon",
      shortName: null,
      logoUrl: null,
      lastPrice: 1,
      dailyReturn: 0.1,
      portfolioSize: 90,
      investorCount: 9,
      category: { code: "CAT", name: "Kategori" },
      fundType: null,
      finalScore: 9,
    },
  ],
};

test("discovery orchestrator flags scope mismatch", () => {
  const health = deriveDiscoveryHealth({
    payload: basePayload,
    scope: { mode: "BEST", categoryCode: "OTHER", theme: null, queryTrim: "" },
    source: "snapshot",
    degradedReason: null,
    failureClass: null,
    stale: false,
    requestConsistent: true,
  });
  assert.equal(health.overallDiscoveryHealth, "invalid");
  assert.equal(health.trustAsFinal, false);
});

test("discovery orchestrator marks healthy payload as trusted", () => {
  const health = deriveDiscoveryHealth({
    payload: basePayload,
    scope: { mode: "BEST", categoryCode: "CAT", theme: null, queryTrim: "" },
    source: "snapshot",
    degradedReason: null,
    failureClass: null,
    stale: false,
    requestConsistent: true,
  });
  assert.equal(health.overallDiscoveryHealth, "healthy");
  assert.equal(health.trustAsFinal, true);
});

test("discovery orchestrator marks theme scope mismatch as invalid", () => {
  const health = deriveDiscoveryHealth({
    payload: basePayload,
    scope: { mode: "BEST", categoryCode: "CAT", theme: "precious_metals", queryTrim: "" },
    source: "snapshot",
    degradedReason: null,
    failureClass: null,
    stale: false,
    requestConsistent: true,
  });
  assert.equal(health.scopeHealth, "invalid");
  assert.equal(health.overallDiscoveryHealth, "invalid");
  assert.equal(health.trustAsFinal, false);
});

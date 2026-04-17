import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateDetailReliability,
  evaluateDiscoveryReliability,
} from "@/lib/fund-data-reliability";

test("detail reliability marks semantically broken payload as invalid", () => {
  const decision = evaluateDetailReliability({
    sourceTier: "serving",
    hasCoreSeries: true,
    hasTrendSeries: true,
    hasComparison: false,
    hasMeaningfulAlternatives: false,
    stale: false,
    partial: true,
    reasons: [],
    failedSteps: [],
  });
  assert.equal(decision.class, "invalid_insufficient");
  assert.equal(decision.canPresentAsTrustedFinalState, false);
  assert.match(decision.reasons.join(","), /comparison_semantically_empty/);
});

test("discovery reliability flags scope drift as invalid", () => {
  const decision = evaluateDiscoveryReliability({
    sourceTier: "snapshot",
    stale: false,
    rows: 30,
    total: 30,
    scopeAligned: false,
    degradedReason: null,
    failureClass: null,
  });
  assert.equal(decision.class, "invalid_insufficient");
  assert.equal(decision.canPresentAsTrustedFinalState, false);
});

test("discovery reliability marks healthy scoped payload current", () => {
  const decision = evaluateDiscoveryReliability({
    sourceTier: "canonical",
    stale: false,
    rows: 120,
    total: 120,
    scopeAligned: true,
    degradedReason: null,
    failureClass: null,
  });
  assert.equal(decision.class, "current");
  assert.equal(decision.canPresentAsTrustedFinalState, true);
});

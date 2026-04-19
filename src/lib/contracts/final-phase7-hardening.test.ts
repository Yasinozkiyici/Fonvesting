import assert from "node:assert/strict";
import test from "node:test";
import { deriveDiscoverySurfaceState } from "@/lib/contracts/discovery-surface-state";
import { deriveSpotlightContract } from "@/lib/contracts/spotlight-contract";
import { deriveFundDetailComparisonContract } from "@/lib/contracts/fund-detail-comparison-subsystem";
import { deriveFreshnessContract, toCanonicalFreshnessContract } from "@/lib/freshness-contract";

test("phase7: discovery refresh hiçbir durumda loading_initial'a geri düşmez", () => {
  const state = deriveDiscoverySurfaceState({
    loading: true,
    error: false,
    hasRenderableRows: true,
    surfaceState: "ready",
    degradedHeader: false,
  });
  assert.equal(state, "loading_refresh");
});

test("phase7: spotlight ve table aynı scoped truth ile hizalı kalır", () => {
  const discovery = {
    scope: { active: true },
    scopeHealth: "healthy",
    matchedTotal: 2,
  };
  const contract = deriveSpotlightContract({
    discoveryActive: true,
    discoverySurface: "ready",
    discoveryContract: discovery as never,
    spotlightFunds: [{ code: "AAA" } as never, { code: "BBB" } as never],
  });
  assert.equal(contract.renderable, true);
  assert.equal(contract.reason, "spotlight_ready");
  assert.equal(contract.cardCount, 2);
});

test("phase7: comparison state deterministic reason üretir", () => {
  const timeout = deriveFundDetailComparisonContract({
    state: "degraded_timeout",
    block: null,
    freshness: null,
    degradedReason: "timeout",
  });
  assert.equal(timeout.renderable, false);
  assert.equal(timeout.reason, "degraded_timeout");

  const sourceUnavailable = deriveFundDetailComparisonContract({
    state: "source_unavailable",
    block: null,
    freshness: null,
    degradedReason: "source_unavailable",
  });
  assert.equal(sourceUnavailable.reason, "source_unavailable");
});

test("phase7: canonical freshness latest sync + degraded reason taşır", () => {
  const base = deriveFreshnessContract({
    asOf: "2026-04-18T00:00:00.000Z",
    freshTtlMs: 1,
    staleTtlMs: 2,
    nowMs: Date.parse("2026-04-19T00:00:00.000Z"),
  });
  const canonical = toCanonicalFreshnessContract(base, "test", {
    latestSuccessfulSyncAt: "2026-04-18T23:45:00.000Z",
    degradedReason: "serving_lagging_raw",
  });
  assert.equal(canonical.latestSuccessfulSyncAt, "2026-04-18T23:45:00.000Z");
  assert.equal(canonical.degradedReason, "serving_lagging_raw");
});


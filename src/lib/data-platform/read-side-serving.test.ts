import test from "node:test";
import assert from "node:assert/strict";
import { enforceServingRouteTrust } from "@/lib/data-platform/read-side-serving-trust";
import type { UiServingWorldMeta } from "@/lib/domain/serving/ui-cutover-contract";

function makeWorld(overrides?: Partial<UiServingWorldMeta>): UiServingWorldMeta {
  return {
    worldId: "build-1",
    worldAligned: true,
    headsPresent: ["fundList", "compare", "discovery", "system"],
    buildIds: {
      fundList: "build-1",
      fundDetail: "build-1",
      compare: "build-1",
      discovery: "build-1",
      system: "build-1",
    },
    snapshotAsOf: {
      fundList: "2026-04-17T00:00:00.000Z",
      fundDetail: "2026-04-17T00:00:00.000Z",
      compare: "2026-04-17T00:00:00.000Z",
      discovery: "2026-04-17T00:00:00.000Z",
      system: "2026-04-17T00:00:00.000Z",
    },
    generatedAtIso: "2026-04-17T00:05:00.000Z",
    ...overrides,
  };
}

test("enforceServingRouteTrust returns trusted for aligned world", () => {
  const trust = enforceServingRouteTrust({
    world: makeWorld(),
    source: "serving_fund_list",
    requiredBuilds: ["fundList", "system"],
    payloadAvailable: true,
    fallbackUsed: false,
  });
  assert.equal(trust.trustAsFinal, true);
  assert.equal(trust.degradedKind, "none");
});

test("enforceServingRouteTrust marks legacy fallback", () => {
  const trust = enforceServingRouteTrust({
    world: makeWorld(),
    source: "serving_fund_list",
    requiredBuilds: ["fundList", "system"],
    payloadAvailable: true,
    fallbackUsed: true,
    fallbackReason: "serving_list_unavailable",
  });
  assert.equal(trust.trustAsFinal, false);
  assert.equal(trust.degradedKind, "legacy_fallback");
  assert.equal(trust.degradedReason, "serving_list_unavailable");
});

test("enforceServingRouteTrust marks missing required build", () => {
  const world = makeWorld({
    buildIds: {
      fundList: "build-1",
      fundDetail: "build-1",
      compare: null,
      discovery: "build-1",
      system: "build-1",
    },
  });
  const trust = enforceServingRouteTrust({
    world,
    source: "serving_compare_inputs",
    requiredBuilds: ["compare", "system"],
    payloadAvailable: true,
    fallbackUsed: false,
  });
  assert.equal(trust.trustAsFinal, false);
  assert.equal(trust.degradedKind, "serving_payload_missing");
  assert.match(trust.degradedReason ?? "", /missing_build_head/);
});

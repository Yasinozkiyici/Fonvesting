import test from "node:test";
import assert from "node:assert/strict";

type ContractGroup = {
  id: string;
  checks: Array<{
    id: string;
    path: string;
    expectedNonEmpty: (payload: unknown) => boolean;
    degradedContract: (payload: unknown) => boolean;
    emptyAllowed: (payload: unknown) => boolean;
  }>;
};

type ScenarioProbe = {
  id: string;
  requiredForGate?: boolean;
};

test("critical path contracts include required groups", async () => {
  const mod = await import("../../scripts/critical-path-contracts.mjs");
  const groups = mod.CRITICAL_API_CONTRACTS as ContractGroup[];
  const ids = new Set(groups.map((g) => g.id));
  for (const required of ["scores", "comparison", "chart", "alternatives", "freshness_state"]) {
    assert.equal(ids.has(required), true, `missing contract group: ${required}`);
  }
});

test("critical path checks expose contract evaluators", async () => {
  const mod = await import("../../scripts/critical-path-contracts.mjs");
  const groups = mod.CRITICAL_API_CONTRACTS as ContractGroup[];
  for (const group of groups) {
    assert.ok(group.checks.length > 0, `group has no checks: ${group.id}`);
    for (const check of group.checks) {
      assert.equal(typeof check.path, "string");
      assert.equal(typeof check.expectedNonEmpty, "function");
      assert.equal(typeof check.degradedContract, "function");
      assert.equal(typeof check.emptyAllowed, "function");
    }
  }
});

test("release gate scenarios keep mandatory probes", async () => {
  const mod = await import("../../scripts/critical-path-contracts.mjs");
  const probes = mod.DEGRADED_SCENARIO_PROBES as ScenarioProbe[];
  const requiredProbeIds = probes.filter((probe) => probe.requiredForGate).map((probe) => probe.id);
  assert.deepEqual(
    requiredProbeIds.sort(),
    ["partial_module_failure", "persisted_cache_available"].sort(),
    "required degraded probes changed unexpectedly"
  );
});

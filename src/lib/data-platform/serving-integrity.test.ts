import test from "node:test";
import assert from "node:assert/strict";
import { evaluateServingUniverseIntegrity } from "@/lib/data-platform/serving-integrity";

test("flags empty serving world as empty and sparse", () => {
  const result = evaluateServingUniverseIntegrity({
    activeFundCount: 100,
    listPayload: { funds: [] },
    comparePayload: { funds: [] },
    discoveryPayload: { funds: [] },
    detailCountForBuild: 0,
  });

  assert.equal(result.empty, true);
  assert.equal(result.sparse, true);
  assert.equal(result.coverageRatio, 0);
});

test("accepts full serving world as non-empty and non-sparse", () => {
  const funds = Array.from({ length: 100 }, (_, i) => ({ code: `F${i}` }));
  const result = evaluateServingUniverseIntegrity({
    activeFundCount: 100,
    listPayload: { funds },
    comparePayload: { funds },
    discoveryPayload: { funds },
    detailCountForBuild: 100,
  });

  assert.equal(result.empty, false);
  assert.equal(result.sparse, false);
  assert.equal(result.coverageRatio, 1);
});

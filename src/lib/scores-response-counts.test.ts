import test from "node:test";
import assert from "node:assert/strict";
import { readScoresMatchedTotal, readScoresUniverseTotal } from "@/lib/scores-response-counts";
import type { ScoredResponse } from "@/types/scored-funds";

test("readScoresUniverseTotal önce explicit universeTotal", () => {
  const p: ScoredResponse = {
    mode: "BEST",
    total: 180,
    universeTotal: 2390,
    matchedTotal: 12,
    returnedCount: 0,
    funds: [],
  };
  assert.equal(readScoresUniverseTotal(p), 2390);
});

test("readScoresMatchedTotal explicit matchedTotal", () => {
  const p: ScoredResponse = {
    mode: "BEST",
    total: 2390,
    universeTotal: 2390,
    matchedTotal: 12,
    returnedCount: 10,
    funds: [],
  };
  assert.equal(readScoresMatchedTotal(p), 12);
});

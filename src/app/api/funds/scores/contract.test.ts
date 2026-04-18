import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveFilteredScopeTotalOrNull,
  resolveScoresApiSurfaceState,
  validateScoresApiPayloadContract,
} from "./contract";
import { createScoresPayload } from "@/lib/services/fund-scores-semantics";

function makePayload(input: {
  universeTotal: number;
  matchedTotal: number;
  rows: number;
}) {
  return createScoresPayload({
    mode: "BEST",
    universeTotal: input.universeTotal,
    matchedTotal: input.matchedTotal,
    funds: Array.from({ length: input.rows }, (_, i) => ({
      fundId: `f-${i}`,
      code: `C${i}`,
      name: `N${i}`,
      shortName: null,
      logoUrl: null,
      lastPrice: 1,
      dailyReturn: 0,
      portfolioSize: 1,
      investorCount: 1,
      category: null,
      fundType: null,
      finalScore: null,
    })),
  });
}

test("scores contract: universe total satır sayısından infer edilmez", () => {
  const payload = makePayload({ universeTotal: 2390, matchedTotal: 2390, rows: 180 });
  const check = validateScoresApiPayloadContract(payload);
  assert.equal(check.valid, true);
  assert.equal(payload.universeTotal, 2390);
  assert.notEqual(payload.universeTotal, payload.funds.length);
});

test("scores contract: filtreli scope matchedTotal ile temsil edilir", () => {
  const payload = makePayload({ universeTotal: 2390, matchedTotal: 12, rows: 10 });
  const check = validateScoresApiPayloadContract(payload);
  assert.equal(check.valid, true);
  assert.equal(payload.matchedTotal, 12);
});

test("scores contract: matchedTotal universeTotal'ı aşamaz", () => {
  const payload = {
    ...makePayload({ universeTotal: 100, matchedTotal: 10, rows: 10 }),
    matchedTotal: 101,
  };
  const check = validateScoresApiPayloadContract(payload);
  assert.equal(check.valid, false);
  assert.equal(check.reason, "matched_total_exceeds_universe_total");
});

test("scores contract: returned rows matchedTotal'ı aşarsa invalid", () => {
  const payload = {
    ...makePayload({ universeTotal: 100, matchedTotal: 10, rows: 10 }),
    matchedTotal: 5,
  };
  const check = validateScoresApiPayloadContract(payload);
  assert.equal(check.valid, false);
  assert.equal(check.reason, "returned_rows_exceed_matched_total");
});

test("scores surface state: ready / valid_empty / degraded_empty", () => {
  const ready = resolveScoresApiSurfaceState({
    payload: makePayload({ universeTotal: 100, matchedTotal: 50, rows: 20 }),
    degradedReason: null,
  });
  assert.equal(ready, "ready");

  const validEmpty = resolveScoresApiSurfaceState({
    payload: makePayload({ universeTotal: 100, matchedTotal: 0, rows: 0 }),
    degradedReason: null,
  });
  assert.equal(validEmpty, "valid_empty");

  const degradedEmpty = resolveScoresApiSurfaceState({
    payload: makePayload({ universeTotal: 100, matchedTotal: 0, rows: 0 }),
    degradedReason: "timeout_empty",
  });
  assert.equal(degradedEmpty, "degraded_empty");
});

test("scores contract: filtered scope payload yoksa total null", () => {
  assert.equal(resolveFilteredScopeTotalOrNull(null), null);
  const payload = makePayload({ universeTotal: 2390, matchedTotal: 7, rows: 5 });
  assert.equal(resolveFilteredScopeTotalOrNull(payload), 7);
});


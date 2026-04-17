import test from "node:test";
import assert from "node:assert/strict";
import {
  hasOptionalEnrichment,
  needsPhase2OptionalRefresh,
  requiresAlternativesRepair,
  type FundDetailSuccessContractPayload,
} from "@/lib/fund-detail-success-contract";

function makePayload(
  overrides: Partial<FundDetailSuccessContractPayload> = {}
): FundDetailSuccessContractPayload {
  return {
    fund: {
      category: { code: "PPF", name: "Para Piyasası Fonu" },
    },
    similarFunds: [],
    similarCategoryPeerDailyReturns: [],
    categoryReturnAverages: null,
    kiyasBlock: null,
    ...overrides,
  };
}

test("comparison present + alternatives empty requires phase2 optional refresh", () => {
  const payload = makePayload({
    kiyasBlock: {
      refs: [{ key: "bist100" }],
      rowsByRef: {
        bist100: [{ periodId: "1y", fundPct: 12.3, refPct: 10.1 }],
      },
    },
    similarFunds: [],
  });
  assert.equal(needsPhase2OptionalRefresh(payload), true);
  assert.equal(requiresAlternativesRepair(payload), true);
});

test("alternatives restored marks payload optional-repair complete", () => {
  const payload = makePayload({
    kiyasBlock: {
      refs: [{ key: "bist100" }],
      rowsByRef: {
        bist100: [{ periodId: "1y", fundPct: 11.8, refPct: 9.4 }],
      },
    },
    similarFunds: [{ code: "AAA" }],
  });
  assert.equal(needsPhase2OptionalRefresh(payload), false);
  assert.equal(requiresAlternativesRepair(payload), false);
});

test("missing comparison still requires phase2 refresh even if alternatives exist", () => {
  const payload = makePayload({
    kiyasBlock: null,
    similarFunds: [{ code: "AAA" }],
  });
  assert.equal(needsPhase2OptionalRefresh(payload), true);
});

test("optional enrichment classification remains true for comparison-only payload", () => {
  const payload = makePayload({
    kiyasBlock: {
      refs: [{ key: "bist100" }],
      rowsByRef: {
        bist100: [{ periodId: "1y", fundPct: 10.2, refPct: 8.6 }],
      },
    },
    similarFunds: [],
  });
  assert.equal(hasOptionalEnrichment(payload), true);
});

test("comparison block without usable 1y values still requires phase2 refresh", () => {
  const payload = makePayload({
    kiyasBlock: {
      refs: [{ key: "bist100" }],
      rowsByRef: {
        bist100: [{ periodId: "1y", fundPct: null, refPct: null }],
      },
    },
    similarFunds: [{ code: "AAA" }],
  });
  assert.equal(needsPhase2OptionalRefresh(payload), true);
});

test("comparison block with finite 1y values can satisfy comparison contract", () => {
  const payload = makePayload({
    kiyasBlock: {
      refs: [{ key: "bist100" }],
      rowsByRef: {
        bist100: [{ periodId: "1y", fundPct: 18.4, refPct: 12.1 }],
      },
    },
    similarFunds: [{ code: "AAA" }],
  });
  assert.equal(needsPhase2OptionalRefresh(payload), false);
});

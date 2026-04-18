import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveHomepageTrueUniverseTotal,
  shouldAttemptFundTableUniverseFallback,
} from "@/lib/homepage-fund-counts";
import type { ScoredResponse } from "@/types/scored-funds";

function makeScores(
  total: number,
  rowCount: number,
  opts?: { universeTotal?: number; matchedTotal?: number }
): ScoredResponse {
  const funds = Array.from({ length: rowCount }, (_, i) => ({
    fundId: `f-${i}`,
    code: `C${i}`,
    name: `N${i}`,
    shortName: null,
    logoUrl: null,
    lastPrice: 1,
    dailyReturn: 0,
    portfolioSize: 1,
    investorCount: 0,
    category: null,
    fundType: null,
    finalScore: 1,
  }));
  const universeTotal = opts?.universeTotal ?? total;
  const matchedTotal = opts?.matchedTotal ?? total;
  return {
    mode: "BEST",
    total: universeTotal,
    universeTotal,
    matchedTotal,
    returnedCount: rowCount,
    funds,
  };
}

test("shouldAttemptFundTableUniverseFallback: yalnızca güvenli bilinmeyen nedenler", () => {
  assert.equal(shouldAttemptFundTableUniverseFallback("scores_total_equals_row_count_at_preview_cap"), true);
  assert.equal(shouldAttemptFundTableUniverseFallback("serving_core_rows_without_canonical_market_snapshot"), true);
  assert.equal(shouldAttemptFundTableUniverseFallback("arbitrary_unknown"), false);
});

test("resolveHomepageTrueUniverseTotal: serving_core asla preview total kullanmaz", () => {
  const r = resolveHomepageTrueUniverseTotal({
    initialScores: null,
    initialRowsSource: "serving_core",
    scoresTimedOut: false,
    scoresPreviewLimit: 180,
    marketSnapshotFundCount: 2390,
    marketSnapshotCanonical: true,
  });
  assert.equal(r.kind, "known");
  if (r.kind === "known") assert.equal(r.value, 2390);
});

test("resolveHomepageTrueUniverseTotal: serving_core + kanonik olmayan market → unknown", () => {
  const r = resolveHomepageTrueUniverseTotal({
    initialScores: null,
    initialRowsSource: "serving_core",
    scoresTimedOut: false,
    scoresPreviewLimit: 180,
    marketSnapshotFundCount: 180,
    marketSnapshotCanonical: false,
  });
  assert.equal(r.kind, "unknown");
});

test("resolveHomepageTrueUniverseTotal: scores total satır sayısına takılırsa market ile düzelt", () => {
  const r = resolveHomepageTrueUniverseTotal({
    initialScores: makeScores(180, 180),
    initialRowsSource: "scores",
    scoresTimedOut: false,
    scoresPreviewLimit: 180,
    marketSnapshotFundCount: 2390,
    marketSnapshotCanonical: true,
  });
  assert.equal(r.kind, "known");
  if (r.kind === "known") assert.equal(r.value, 2390);
});

test("resolveHomepageTrueUniverseTotal: scores total tutarlıysa scores kullan", () => {
  const r = resolveHomepageTrueUniverseTotal({
    initialScores: makeScores(500, 180),
    initialRowsSource: "scores",
    scoresTimedOut: false,
    scoresPreviewLimit: 180,
    marketSnapshotFundCount: null,
    marketSnapshotCanonical: true,
  });
  assert.equal(r.kind, "known");
  if (r.kind === "known") assert.equal(r.value, 500);
});

test("resolveHomepageTrueUniverseTotal: universeTotal tema eşleşmesinden bağımsız okunur (180 evren sanılmasın)", () => {
  const r = resolveHomepageTrueUniverseTotal({
    initialScores: makeScores(180, 180, { universeTotal: 2390, matchedTotal: 180 }),
    initialRowsSource: "scores",
    scoresTimedOut: false,
    scoresPreviewLimit: 180,
    marketSnapshotFundCount: null,
    marketSnapshotCanonical: true,
  });
  assert.equal(r.kind, "known");
  if (r.kind === "known") assert.equal(r.value, 2390);
});

import test from "node:test";
import assert from "node:assert/strict";
import { formatHomepageCountCaption } from "@/components/tefas/ScoredFundsTable";
import { readScoresMatchedTotal, readScoresUniverseTotal } from "@/lib/scores-response-counts";
import type { ScoredResponse } from "@/types/scored-funds";

function payload(
  universe: number,
  matched: number,
  rowCount: number
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
  return {
    mode: "BEST",
    total: universe,
    universeTotal: universe,
    matchedTotal: matched,
    returnedCount: rowCount,
    funds,
  };
}

test("caption: filtrede matchedTotal kullanılır (evren 2390, eşleşen 12, satır 10)", () => {
  const p = payload(2390, 12, 10);
  const registeredTotal = readScoresMatchedTotal(p);
  const caption = formatHomepageCountCaption({
    shown: 5,
    registeredTotal,
    loadedCount: p.funds.length,
    hasFilters: true,
    filteredHint: "tema",
  });
  assert.match(caption, /12/);
  assert.doesNotMatch(caption, /2390.*fon · tema/);
});

test("caption: filtresiz evren readScoresUniverseTotal (önizleme 180 evren 500)", () => {
  const p = payload(500, 500, 180);
  const registeredTotal = readScoresUniverseTotal(p);
  const caption = formatHomepageCountCaption({
    shown: 180,
    registeredTotal,
    loadedCount: p.funds.length,
    hasFilters: false,
    filteredHint: null,
  });
  assert.match(caption, /Önizleme/);
  assert.match(caption, /500/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { filterScoresPayloadByQuery, filterScoresPayloadByTheme } from "@/lib/services/fund-scores-compute.service";
import { createScoresPayload } from "@/lib/services/fund-scores-semantics";
import type { ScoredFundRow } from "@/lib/services/fund-scores-types";

function row(partial: Partial<ScoredFundRow> & Pick<ScoredFundRow, "name">): ScoredFundRow {
  return {
    fundId: partial.fundId ?? "id-1",
    code: partial.code ?? "CODE",
    name: partial.name,
    shortName: partial.shortName ?? null,
    logoUrl: partial.logoUrl ?? null,
    lastPrice: partial.lastPrice ?? 1,
    dailyReturn: partial.dailyReturn ?? 0,
    portfolioSize: partial.portfolioSize ?? 1,
    investorCount: partial.investorCount ?? 0,
    category: partial.category ?? null,
    fundType: partial.fundType ?? null,
    finalScore: partial.finalScore ?? 1,
    themeTags: partial.themeTags,
  };
}

test("tema filtresi universeTotal korur, matchedTotal düşer", () => {
  const base = createScoresPayload({
    mode: "BEST",
    funds: [row({ name: "Teknoloji ve iletişim fonu", code: "T1" }), row({ name: "Para piyasası fonu", code: "P1" })],
    universeTotal: 500,
    matchedTotal: 500,
  });
  const themed = filterScoresPayloadByTheme(base, "technology");
  assert.equal(themed.universeTotal, 500);
  assert.equal(themed.matchedTotal, 1);
  assert.equal(themed.returnedCount, themed.funds.length);
  assert.equal(themed.total, 500);
});

test("metin araması universeTotal korur, matchedTotal daralır", () => {
  const base = createScoresPayload({
    mode: "BEST",
    funds: [row({ name: "İş Portföy Hisse", code: "TI1" }), row({ name: "Diğer", code: "XX" })],
    universeTotal: 400,
    matchedTotal: 400,
  });
  const filtered = filterScoresPayloadByQuery(base, "TI1");
  assert.equal(filtered.universeTotal, 400);
  assert.equal(filtered.matchedTotal, 1);
  assert.equal(filtered.appliedQuery, "TI1");
});

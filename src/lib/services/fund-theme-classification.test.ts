import test from "node:test";
import assert from "node:assert/strict";
import { filterScoresPayloadByTheme } from "@/lib/services/fund-scores-compute.service";
import { createScoresPayload } from "@/lib/services/fund-scores-semantics";
import type { ScoredFundRow } from "@/lib/services/fund-scores-types";
import { fundRowMatchesCanonicalTheme, inferThemeTagsFromFundFields } from "@/lib/services/fund-theme-classification";

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

test("inferThemeTagsFromFundFields deterministik ve tekrarlanabilir", () => {
  const a = inferThemeTagsFromFundFields("AK PORTFOY YENI TEKNOLOJILER YABANCI HISSE SENEDI FONU", null);
  const b = inferThemeTagsFromFundFields("AK PORTFOY YENI TEKNOLOJILER YABANCI HISSE SENEDI FONU", null);
  assert.deepEqual(a, b);
  assert.ok(a.includes("technology"));
});

test("themeTags dolu satırda isim token’ları yanlış temaya itmez (kanonik öncelik)", () => {
  const fund = row({
    name: "BLOCKCHAIN TEKNOLOJI BLOCKZINCIRI RASTGELE METIN",
    code: "X1",
    themeTags: ["technology"],
  });
  assert.equal(fundRowMatchesCanonicalTheme(fund, "technology"), true);
  assert.equal(fundRowMatchesCanonicalTheme(fund, "blockchain"), false);
});

test("filterScoresPayloadByTheme matchedTotal themeTags ile sınıflandırmaya dayanır", () => {
  const base = createScoresPayload({
    mode: "BEST",
    funds: [
      row({
        name: "Sadece isimde blockchain kelimesi",
        code: "A",
        themeTags: ["technology"],
      }),
      row({ name: "Para piyasası", code: "B", themeTags: [] }),
    ],
    universeTotal: 100,
    matchedTotal: 100,
  });
  const blockchainOnly = filterScoresPayloadByTheme(base, "blockchain");
  assert.equal(blockchainOnly.matchedTotal, 0);
  assert.equal(blockchainOnly.funds.length, 0);

  const tech = filterScoresPayloadByTheme(base, "technology");
  assert.equal(tech.matchedTotal, 1);
  assert.equal(tech.funds.length, 1);
  assert.equal(tech.funds[0]?.code, "A");
});

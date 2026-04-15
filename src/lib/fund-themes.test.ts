import test from "node:test";
import assert from "node:assert/strict";
import { fundMatchesTheme } from "@/lib/fund-themes";
import type { ScoredFund } from "@/types/scored-funds";

function fund(code: string, name: string): ScoredFund {
  return {
    fundId: code,
    code,
    name,
    shortName: code,
    logoUrl: null,
    lastPrice: 1,
    dailyReturn: 0,
    portfolioSize: 1,
    investorCount: 1,
    category: null,
    fundType: null,
    finalScore: null,
  };
}

test("thematic discovery matches real fund naming variants", () => {
  assert.equal(
    fundMatchesTheme(fund("AOY", "AK PORTFOY ALTERNATIF ENERJI YABANCI HISSE SENEDI FONU"), "green_energy"),
    true
  );
  assert.equal(
    fundMatchesTheme(fund("FJB", "FIBA PORTFOY BLOK ZINCIRI TEKNOLOJILERI SERBEST FON"), "blockchain"),
    true
  );
  assert.equal(
    fundMatchesTheme(fund("JET", "ATA PORTFOY HAVACILIK VE SAVUNMA TEKNOLOJILERI DEGISKEN FON"), "defense"),
    true
  );
  assert.equal(
    fundMatchesTheme(fund("YJK", "YAPI KREDI PORTFOY ROBOTIK VE YARI ILETKEN TEKNOLOJILERI FON SEPETI FONU"), "artificial_intelligence"),
    true
  );
  assert.equal(
    fundMatchesTheme(fund("AFT", "AK PORTFOY YENI TEKNOLOJILER YABANCI HISSE SENEDI FONU"), "technology"),
    true
  );
});

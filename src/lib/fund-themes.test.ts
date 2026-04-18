import test from "node:test";
import assert from "node:assert/strict";
import { fundMatchesTheme, parseFundThemeParam } from "@/lib/fund-themes";
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

test("parseFundThemeParam nullish ve boş anahtar güvenli", () => {
  assert.equal(parseFundThemeParam(undefined), null);
  assert.equal(parseFundThemeParam(null as unknown as string), null);
  assert.equal(parseFundThemeParam(""), null);
  assert.equal(parseFundThemeParam("   "), null);
  assert.equal(parseFundThemeParam("technology"), "technology");
});

test("fundMatchesTheme tüm temalarda null isimle normalizeText yolunu patlatmaz", () => {
  const base = fund("X", "y");
  const broken = { ...base, name: null as unknown as string };
  const ids = [
    "technology",
    "artificial_intelligence",
    "green_energy",
    "blockchain",
    "precious_metals",
    "defense",
    "health_biotech",
  ] as const;
  for (const id of ids) {
    assert.doesNotThrow(() => fundMatchesTheme(broken, id));
  }
});

test("fundMatchesTheme bozuk/null isimde TypeError fırlatmaz", () => {
  const base = fund("TST", "Geçerli ad");
  const withNullName = { ...base, name: null as unknown as string };
  assert.doesNotThrow(() => fundMatchesTheme(withNullName, "technology"));
  const withNullShort = { ...base, shortName: null };
  assert.doesNotThrow(() => fundMatchesTheme(withNullShort, "technology"));
});

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

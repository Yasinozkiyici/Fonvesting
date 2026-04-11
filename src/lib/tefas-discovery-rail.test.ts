import test from "node:test";
import assert from "node:assert/strict";
import { resolveCategoryCodeByHints, resolveDiscoveryFilters } from "@/lib/tefas-discovery-rail";

test("resolveCategoryCodeByHints: ipucu kategori adında bulunur", () => {
  const cats = [
    { code: "HSF", name: "Hisse Senedi Fonu" },
    { code: "PPF", name: "Para Piyasası Fonu" },
  ];
  assert.equal(resolveCategoryCodeByHints(cats, ["para piyasası"]), "PPF");
  assert.equal(resolveCategoryCodeByHints(cats, ["hisse senedi"]), "HSF");
});

test("resolveDiscoveryFilters: tematik secondary tema döndürür", () => {
  const r = resolveDiscoveryFilters("thematic", "blockchain", []);
  assert.equal(r.themeId, "blockchain");
  assert.equal(r.categoryCode, "");
  assert.ok(r.secondaryLabel.length > 0);
});

test("resolveDiscoveryFilters: kategoriler primary kodu secondary yapar", () => {
  const cats = [{ code: "K1", name: "Katılım" }];
  const r = resolveDiscoveryFilters("categories", "K1", cats);
  assert.equal(r.categoryCode, "K1");
  assert.equal(r.themeId, null);
});

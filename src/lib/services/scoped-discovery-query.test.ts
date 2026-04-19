import test from "node:test";
import assert from "node:assert/strict";
import {
  materializeServingDiscoveryScopeFirst,
  resolveEffectiveScoresLimit,
} from "@/lib/services/scoped-discovery-query.service";
import { DEFAULT_SCOPED_DISCOVERY_LIMIT } from "@/lib/contracts/discovery-limits";
import type { ServingDiscoveryRow, ServingListRow } from "@/lib/data-platform/read-side-serving";

test("resolveEffectiveScoresLimit: tema veya q yoksa ve istek yoksa limit null", () => {
  assert.equal(
    resolveEffectiveScoresLimit({ requested: null, theme: null, queryTrim: "" }),
    null
  );
});

test("resolveEffectiveScoresLimit: tema varken varsayılan dar pencere", () => {
  assert.equal(
    resolveEffectiveScoresLimit({ requested: null, theme: "technology", queryTrim: "" }),
    DEFAULT_SCOPED_DISCOVERY_LIMIT
  );
});

test("resolveEffectiveScoresLimit: açık istek üst sınırla kısıtlanır", () => {
  assert.equal(resolveEffectiveScoresLimit({ requested: 9999, theme: null, queryTrim: "" }), 500);
});

test("materializeServingDiscoveryScopeFirst: tema önce süzülür, matchedTotal limit öncesi", () => {
  const rows: ServingDiscoveryRow[] = [
    { rank: 1, code: "A", score: 10, categoryCode: "C1", portfolioSize: 1 },
    { rank: 2, code: "B", score: 9, categoryCode: "C1", portfolioSize: 1 },
  ];
  const list: ServingListRow[] = [
    {
      code: "A",
      name: "Tech A",
      shortName: null,
      categoryCode: "C1",
      fundTypeCode: 1,
      lastPrice: 1,
      dailyReturn: 0,
      monthlyReturn: 0,
      yearlyReturn: 0,
      portfolioSize: 1,
      investorCount: 1,
      themeTags: ["technology"],
      searchHaystack: "a",
    },
    {
      code: "B",
      name: "Cash B",
      shortName: null,
      categoryCode: "C1",
      fundTypeCode: 1,
      lastPrice: 1,
      dailyReturn: 0,
      monthlyReturn: 0,
      yearlyReturn: 0,
      portfolioSize: 1,
      investorCount: 1,
      themeTags: [],
      searchHaystack: "b",
    },
  ];
  const fundsByCode = new Map(list.map((f) => [f.code.toUpperCase(), f]));
  const payload = materializeServingDiscoveryScopeFirst({
    mode: "BEST",
    rankedRows: rows,
    fundsByCode,
    categoryCode: "",
    theme: "technology",
    queryTrim: "",
    universeTotal: 500,
    resultLimit: 1,
  });
  assert.equal(payload.matchedTotal, 1);
  assert.equal(payload.funds.length, 1);
  assert.equal(payload.funds[0]?.code, "A");
});

test("materializeServingDiscoveryScopeFirst: tablo ve öne çıkan üçlü aynı sıralı kaynaktan dilimlenir", () => {
  const rows: ServingDiscoveryRow[] = [
    { rank: 1, code: "X", score: 5, categoryCode: null, portfolioSize: 2 },
    { rank: 2, code: "Y", score: 4, categoryCode: null, portfolioSize: 1 },
    { rank: 3, code: "Z", score: 3, categoryCode: null, portfolioSize: 1 },
  ];
  const mk = (code: string, score: number): ServingListRow => ({
    code,
    name: code,
    shortName: null,
    categoryCode: null,
    fundTypeCode: 1,
    lastPrice: 1,
    dailyReturn: 0,
    monthlyReturn: 0,
    yearlyReturn: 0,
    portfolioSize: 1,
    investorCount: 1,
    themeTags: ["technology"],
    searchHaystack: code,
  });
  const fundsByCode = new Map(
    rows.map((r) => [r.code.toUpperCase(), mk(r.code, r.score)])
  );
  const full = materializeServingDiscoveryScopeFirst({
    mode: "BEST",
    rankedRows: rows,
    fundsByCode,
    categoryCode: "",
    theme: "technology",
    queryTrim: "",
    universeTotal: 100,
    resultLimit: 10,
  });
  const top3 = materializeServingDiscoveryScopeFirst({
    mode: "BEST",
    rankedRows: rows,
    fundsByCode,
    categoryCode: "",
    theme: "technology",
    queryTrim: "",
    universeTotal: 100,
    resultLimit: 3,
  });
  assert.deepEqual(
    top3.funds.map((f) => f.code),
    full.funds.slice(0, 3).map((f) => f.code)
  );
});

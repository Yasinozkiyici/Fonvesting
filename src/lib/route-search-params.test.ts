import test from "node:test";
import assert from "node:assert/strict";
import { readSearchParam, type RouteSearchParams } from "@/lib/route-search-params";

test("readSearchParam reads the first matching scalar or array value", () => {
  const params: RouteSearchParams = {
    q: "altın",
    sector: ["ALTIN", "HISSE"],
    index: undefined,
  };

  assert.equal(readSearchParam(params, "q", "query"), "altın");
  assert.equal(readSearchParam(params, "sector", "category"), "ALTIN");
  assert.equal(readSearchParam(params, "index", "fundType"), "");
});

import test from "node:test";
import assert from "node:assert/strict";
import { describeHomeMarketFundCell } from "@/lib/home-market-fund-stats";

test("describeHomeMarketFundCell: aynı sayıda klasik Fon sayısı", () => {
  const r = describeHomeMarketFundCell({ snapshotFundCount: 2000, exploreUniverseTotal: 2000 });
  assert.equal(r.primaryLabel, "Fon sayısı");
  assert.equal(r.primaryValue, "2.000");
  assert.equal(r.secondaryLine, null);
});

test("describeHomeMarketFundCell: keşif evreni küçükse Keşif listesi + portföy kaydı", () => {
  const r = describeHomeMarketFundCell({ snapshotFundCount: 2390, exploreUniverseTotal: 1563 });
  assert.equal(r.primaryLabel, "Keşif listesi");
  assert.equal(r.primaryValue, "1.563");
  assert.equal(r.secondaryLine, "2.390 portföy kaydı");
  assert.match(r.fullDescription, /1\.563/);
  assert.match(r.fullDescription, /2\.390/);
});

test("describeHomeMarketFundCell: explore null ise yalnızca snapshot", () => {
  const r = describeHomeMarketFundCell({ snapshotFundCount: 2390, exploreUniverseTotal: null });
  assert.equal(r.primaryLabel, "Fon sayısı");
  assert.equal(r.primaryValue, "2.390");
  assert.equal(r.secondaryLine, null);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("phase1 history upgrade defaults to enabled for short detail series", () => {
  const source = fs.readFileSync(path.resolve("src/lib/services/fund-detail.service.ts"), "utf8");
  assert.match(
    source,
    /const DETAIL_PHASE1_HISTORY_UPGRADE_ENABLED = process\.env\.FUND_DETAIL_PHASE1_HISTORY_UPGRADE !== "0";/
  );
  assert.match(
    source,
    /payload\.priceSeries\.length < DETAIL_PHASE1_HISTORY_UPGRADE_MIN_POINTS/
  );
  assert.match(
    source,
    /source === "snapshot_fallback" \|\| source === "approx" \|\| source === "serving" \|\| source === "unknown"/
  );
});

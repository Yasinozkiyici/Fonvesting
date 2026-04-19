import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("phase5: fund-detail core no longer builds kiyasBlock inline", () => {
  const source = fs.readFileSync(path.resolve("src/lib/services/fund-detail.service.ts"), "utf8");
  assert.equal(source.includes("buildFundKiyasBlock("), false);
  assert.equal(source.includes("optional_kiyas_block_query"), true);
});


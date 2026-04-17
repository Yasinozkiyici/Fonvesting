import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("phase2 selective merge can recover alternatives when cache is compare-only", () => {
  const source = fs.readFileSync(path.resolve("src/lib/services/fund-detail.service.ts"), "utf8");
  assert.match(source, /shouldMergeAlternatives/);
  assert.match(source, /similarFunds:\s*incomingAlternatives/);
  assert.match(source, /write=\$\{refreshPhase\}_selective_merge/);
  assert.match(source, /if \(snapshotFallbackPayload\.similarFunds\.length === 0 && snapshotCategoryCode\)/);
});

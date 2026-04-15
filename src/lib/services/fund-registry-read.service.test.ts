import test from "node:test";
import assert from "node:assert/strict";
import { buildFundCodeInClause } from "@/lib/services/fund-registry-read.util";

test("buildCodeInClause produces deterministic REST in-clause", () => {
  const clause = buildFundCodeInClause(["VGA", "TI1", "ZP8"]);
  assert.equal(clause, '("VGA","TI1","ZP8")');
});

test("buildCodeInClause strips double quotes from codes", () => {
  const clause = buildFundCodeInClause(['VG"A', 'T"I1']);
  assert.equal(clause, '("VGA","TI1")');
});

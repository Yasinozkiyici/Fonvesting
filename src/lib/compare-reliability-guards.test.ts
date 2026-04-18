import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("compare-series route exposes health and trust headers", () => {
  const source = fs.readFileSync(path.resolve("src/app/api/funds/compare-series/route.ts"), "utf8");
  assert.match(source, /X-Compare-Series-Base-Health/);
  assert.match(source, /X-Compare-Series-Health/);
  assert.match(source, /X-Compare-Series-Trust-Final/);
});

test("compare route exposes compare health headers", () => {
  const source = fs.readFileSync(path.resolve("src/app/api/funds/compare/route.ts"), "utf8");
  assert.match(source, /X-Compare-Health/);
  assert.match(source, /X-Compare-Trust-Final/);
});

test("compare path uses request-level trace helper", () => {
  const inst = fs.readFileSync(path.resolve("src/lib/compare-path-instrumentation.ts"), "utf8");
  assert.match(inst, /X-Compare-Path-Trace-Id/);
  const compare = fs.readFileSync(path.resolve("src/app/api/funds/compare/route.ts"), "utf8");
  const series = fs.readFileSync(path.resolve("src/app/api/funds/compare-series/route.ts"), "utf8");
  assert.match(compare, /createComparePathTrace/);
  assert.match(series, /createComparePathTrace/);
});

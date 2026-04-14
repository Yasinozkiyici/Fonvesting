import assert from "node:assert/strict";
import test from "node:test";
import { buildLinearPathD, buildMonotoneXPathD, dedupeChartPointsByX } from "@/lib/chart-monotone-path";

test("chart-monotone-path: iki nokta doğrusal monotone", () => {
  const pts = [
    { x: 0, y: 100 },
    { x: 100, y: 0 },
  ];
  const d = buildMonotoneXPathD(pts);
  assert.ok(d);
  assert.match(d!, /^M /);
  assert.match(d!, /L 100\.00 0\.00$/);
});

test("chart-monotone-path: üç nokta cubic içerir", () => {
  const pts = [
    { x: 0, y: 10 },
    { x: 50, y: 30 },
    { x: 100, y: 20 },
  ];
  const d = buildMonotoneXPathD(pts);
  assert.ok(d?.includes("C "));
});

test("chart-monotone-path: linear path", () => {
  const d = buildLinearPathD([
    { x: 0, y: 0 },
    { x: 10, y: 5 },
  ]);
  assert.equal(d, "M 0.00 0.00 L 10.00 5.00");
});

test("chart-monotone-path: dedupe aynı x", () => {
  const d = dedupeChartPointsByX([
    { x: 10, y: 1 },
    { x: 10, y: 2 },
    { x: 20, y: 3 },
  ]);
  assert.equal(d.length, 2);
  assert.equal(d[0]!.y, 2);
});

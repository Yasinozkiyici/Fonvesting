import test from "node:test";
import assert from "node:assert/strict";
import { macroTotalReturnPctForWindow } from "@/lib/kiyas-macro-window";

test("kiyasMacroTotalReturnPct: fund-ref farkını doğru üretmek için makro getiri hesaplar", () => {
  const series = [
    { date: new Date("2025-04-10T00:00:00.000Z"), value: 100 },
    { date: new Date("2026-04-10T00:00:00.000Z"), value: 110 },
  ];
  const anchor = new Date("2026-04-10T00:00:00.000Z");
  const refReturn = macroTotalReturnPctForWindow(series, anchor, 365, 10);
  assert.ok(refReturn != null);
  assert.ok(Math.abs(refReturn - 10) < 1e-9);
});

test("kiyasMacroTotalReturnPct: pencere başı ve sonu aynı örneğe düşerse null döner", () => {
  const series = [{ date: new Date("2025-04-07T00:00:00.000Z"), value: 100 }];
  const anchor = new Date("2026-04-10T00:00:00.000Z");
  const refReturn = macroTotalReturnPctForWindow(series, anchor, 365, 10);
  assert.equal(refReturn, null);
});

test("kiyasMacroTotalReturnPct: son makro veri anchor'a göre bayatsa null döner", () => {
  const series = [
    { date: new Date("2026-03-10T00:00:00.000Z"), value: 100 },
    { date: new Date("2026-03-20T00:00:00.000Z"), value: 105 },
  ];
  const anchor = new Date("2026-04-10T00:00:00.000Z");
  const refReturn = macroTotalReturnPctForWindow(series, anchor, 30, 10);
  assert.equal(refReturn, null);
});

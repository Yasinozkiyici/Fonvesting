import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyDailyReturnPctPoints2dp,
  countDailyReturnDirections,
  formatDailyReturnPctPointsTr,
  roundDailyReturnPctPoints2dp,
} from "./daily-return-ui";

test("value = 0 → nötr, 0,00%, gri tonu (sign neutral)", () => {
  assert.equal(classifyDailyReturnPctPoints2dp(0), "neutral");
  const f = formatDailyReturnPctPointsTr(0);
  assert.equal(f.sign, "neutral");
  assert.equal(f.text, "0,00%");
});

test("çok küçük negatif (2 ondalıkta 0,00) → nötr gösterim", () => {
  const v = -0.001;
  assert.equal(roundDailyReturnPctPoints2dp(v), 0);
  assert.equal(classifyDailyReturnPctPoints2dp(v), "neutral");
  const f = formatDailyReturnPctPointsTr(v);
  assert.equal(f.text, "0,00%");
  assert.equal(f.sign, "neutral");
});

test("çok küçük pozitif (2 ondalıkta 0,00) → nötr gösterim", () => {
  const v = 0.002;
  assert.equal(roundDailyReturnPctPoints2dp(v), 0);
  assert.equal(classifyDailyReturnPctPoints2dp(v), "neutral");
  const f = formatDailyReturnPctPointsTr(v);
  assert.equal(f.text, "0,00%");
  assert.equal(f.sign, "neutral");
});

test("anlamlı negatif → negative", () => {
  const v = -0.06;
  assert.equal(classifyDailyReturnPctPoints2dp(v), "negative");
  const f = formatDailyReturnPctPointsTr(v);
  assert.equal(f.sign, "negative");
  assert.match(f.text, /^-/);
  assert.ok(!f.text.includes("-0,00"));
});

test("anlamlı pozitif → positive", () => {
  const v = 0.08;
  assert.equal(classifyDailyReturnPctPoints2dp(v), "positive");
  const f = formatDailyReturnPctPointsTr(v);
  assert.equal(f.sign, "positive");
  assert.ok(f.text.startsWith("+"));
});

test("yön dağılımı: pozitif + negatif + nötr = toplam", () => {
  const values = [0, -0.001, 0.002, -1.2, 2.5, 0.006, -0.006];
  const c = countDailyReturnDirections(values);
  assert.equal(c.advancers + c.decliners + c.unchanged, c.total);
  assert.equal(c.total, values.length);
  assert.equal(c.advancers, 2);
  assert.equal(c.decliners, 2);
  assert.equal(c.unchanged, 3);
});

test("format: -0,00% üretilmez", () => {
  const f = formatDailyReturnPctPointsTr(-0.00001);
  assert.equal(f.text, "0,00%");
});

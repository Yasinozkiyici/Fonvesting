import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCompareSeriesResponseBody } from "@/lib/compare-series-client-payload";

const minimalSeries = [
  { t: 1, v: 1 },
  { t: 2, v: 1.01 },
];

test("compare-series: meta ile birlikte gelen yanıt normalize edilir", () => {
  const out = normalizeCompareSeriesResponseBody({
    fundSeries: [
      { key: "fund:AAA", label: "AAA", code: "AAA", series: minimalSeries },
    ],
    macroSeries: {
      category: minimalSeries,
      bist100: minimalSeries,
      usdtry: minimalSeries,
      eurtry: minimalSeries,
      gold: minimalSeries,
      policy: minimalSeries,
    },
    labels: { bist100: "BIST 100" },
    meta: { trustAsFinal: true },
  });
  assert.ok(out);
  assert.equal(out!.fundSeries.length, 1);
  assert.equal(out!.macroSeries.bist100.length, 2);
  assert.equal(out!.labels.bist100, "BIST 100");
});

test("compare-series: error alanı varsa null", () => {
  assert.equal(normalizeCompareSeriesResponseBody({ error: "base_not_found" }), null);
});

test("compare-series: macroSeries eksikse null", () => {
  assert.equal(
    normalizeCompareSeriesResponseBody({
      fundSeries: [{ key: "fund:AAA", label: "A", code: "AAA", series: minimalSeries }],
    }),
    null
  );
});

test("compare-series: seri noktası geçersizse null", () => {
  assert.equal(
    normalizeCompareSeriesResponseBody({
      fundSeries: [{ key: "fund:AAA", label: "A", code: "AAA", series: [{ t: 1, v: Number.NaN }] }],
      macroSeries: {
        category: minimalSeries,
        bist100: minimalSeries,
        usdtry: minimalSeries,
        eurtry: minimalSeries,
        gold: minimalSeries,
        policy: minimalSeries,
      },
    }),
    null
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildBenchmarkComparisonView, summarizeBenchmarkComparisonViewForDev } from "@/lib/fund-detail-comparison";
import type { FundKiyasViewPayload } from "@/lib/services/fund-detail-kiyas.service";
import { kiyasPolicyReturnPctForWindow } from "@/lib/kiyas-policy-return-window";

function makeBlock(rowsByRef: FundKiyasViewPayload["rowsByRef"]): FundKiyasViewPayload {
  return {
    refs: [
      { key: "gold", label: "Altın" },
      { key: "bist100", label: "BIST 100" },
      { key: "usdtry", label: "USD/TRY" },
    ],
    defaultRef: "gold",
    rowsByRef,
    summaryByRef: {},
    chartMacroByRef: {},
    categoryReturnSlice: null,
    chartSummaryByRef: {},
  };
}

test("outperform durumunda farkı fund - benchmark hesaplar", () => {
  const view = buildBenchmarkComparisonView({
    block: makeBlock({
      gold: [
        {
          periodId: "1y",
          label: "1 Yıl",
          fundPct: 26.55,
          refPct: 18.1,
          refPolicyDeltaPp: null,
          band: "above",
          diffPct: 999,
        },
      ],
    }),
    periodId: "1y",
    preferredOrder: ["gold"],
  });

  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0]!.referenceReturnPct, 18.1);
  assert.ok(Math.abs(view.rows[0]!.comparisonDeltaPct - 8.45) < 1e-9);
  assert.equal(view.rows[0]!.outcome, "outperform");
});

test("underperform durumunda negatif fark üretir", () => {
  const view = buildBenchmarkComparisonView({
    block: makeBlock({
      bist100: [
        {
          periodId: "1y",
          label: "1 Yıl",
          fundPct: 26.55,
          refPct: 40.3,
          refPolicyDeltaPp: null,
          band: "below",
          diffPct: null,
        },
      ],
    }),
    periodId: "1y",
    preferredOrder: ["bist100"],
  });

  assert.ok(Math.abs(view.rows[0]!.comparisonDeltaPct + 13.75) < 1e-9);
  assert.equal(view.rows[0]!.outcome, "underperform");
});

test("eşit/çok yakın durumda neutral döner (|fark| ≤ eşik)", () => {
  const view = buildBenchmarkComparisonView({
    block: makeBlock({
      usdtry: [
        {
          periodId: "1y",
          label: "1 Yıl",
          fundPct: 10.05,
          refPct: 10.0,
          refPolicyDeltaPp: null,
          band: "near",
          diffPct: null,
        },
      ],
    }),
    periodId: "1y",
    preferredOrder: ["usdtry"],
  });

  assert.ok(Math.abs(view.rows[0]!.comparisonDeltaPct - 0.05) < 1e-9);
  assert.equal(view.rows[0]!.outcome, "neutral");
});

test("seçili dönemde benchmark verisi yoksa row unavailable olur", () => {
  const view = buildBenchmarkComparisonView({
    block: makeBlock({
      gold: [
        {
          periodId: "6m",
          label: "6 Ay",
          fundPct: 9.5,
          refPct: 8.3,
          refPolicyDeltaPp: null,
          band: "above",
          diffPct: null,
        },
      ],
    }),
    periodId: "1y",
    preferredOrder: ["gold"],
  });

  assert.equal(view.rows.length, 0);
  assert.equal(view.unavailableRefs.length, 1);
  assert.equal(view.unavailableRefs[0]!.key, "gold");
});

test("yanlış fallback imkansız: benchmark missing ise row üretilmez", () => {
  const view = buildBenchmarkComparisonView({
    block: makeBlock({
      gold: [
        {
          periodId: "1y",
          label: "1 Yıl",
          fundPct: 26.55,
          refPct: null,
          refPolicyDeltaPp: null,
          band: null,
          diffPct: null,
        },
      ],
    }),
    periodId: "1y",
    preferredOrder: ["gold"],
  });

  assert.equal(view.rows.length, 0);
  assert.equal(view.unavailableRefs.length, 1);
});

test("özet: geçti, geride ve başa baş sayıları eşiğe göre toplanır", () => {
  const view = buildBenchmarkComparisonView({
    block: null,
    periodId: "1y",
    preferredOrder: ["bist100", "usdtry", "gold"],
    labels: { bist100: "BIST", usdtry: "USD", gold: "Altın" },
    seriesWindow: {
      fundSeries: [
        { t: 1000, v: 100 },
        { t: 2000, v: 100 },
      ],
      refSeriesByKey: {
        bist100: [
          { t: 1000, v: 100 },
          { t: 2000, v: 100 },
        ],
        usdtry: [
          { t: 1000, v: 100 },
          { t: 2000, v: 90 },
        ],
        gold: [
          { t: 1000, v: 100 },
          { t: 2000, v: 102 },
        ],
      },
      startT: 1000,
      endT: 2000,
    },
  });

  assert.equal(view.rows.length, 3);
  assert.equal(view.tiedCount, 1);
  assert.equal(view.passedCount, 1);
  assert.equal(view.behindCount, 1);
});

test("series window: fund > benchmark olduğunda geçti sayılır", () => {
  const view = buildBenchmarkComparisonView({
    block: null,
    periodId: "1y",
    preferredOrder: ["bist100"],
    labels: { bist100: "BIST 100" },
    seriesWindow: {
      fundSeries: [
        { t: 1000, v: 100 },
        { t: 2000, v: 120 },
      ],
      refSeriesByKey: {
        bist100: [
          { t: 1000, v: 100 },
          { t: 2000, v: 110 },
        ],
      },
      startT: 1000,
      endT: 2000,
    },
  });

  assert.equal(view.rows.length, 1);
  assert.equal(view.passedCount, 1);
  assert.ok(Math.abs((view.rows[0]?.fundReturnPct ?? 0) - 20) < 1e-9);
  assert.ok(Math.abs((view.rows[0]?.referenceReturnPct ?? 0) - 10) < 1e-9);
  assert.ok(Math.abs((view.rows[0]?.comparisonDeltaPct ?? 0) - 10) < 1e-9);
  assert.equal(view.rows[0]?.periodStartMs, 1000);
  assert.equal(view.rows[0]?.periodEndMs, 2000);
});

test("series window: fund < benchmark olduğunda geçemedi sayılır", () => {
  const view = buildBenchmarkComparisonView({
    block: null,
    periodId: "1y",
    preferredOrder: ["usdtry"],
    labels: { usdtry: "USD/TRY" },
    seriesWindow: {
      fundSeries: [
        { t: 1000, v: 100 },
        { t: 2000, v: 105 },
      ],
      refSeriesByKey: {
        usdtry: [
          { t: 1000, v: 100 },
          { t: 2000, v: 112 },
        ],
      },
      startT: 1000,
      endT: 2000,
    },
  });

  assert.equal(view.rows.length, 1);
  assert.equal(view.passedCount, 0);
  assert.equal(view.rows[0]?.outcome, "underperform");
});

test("series window: benchmark serisi boşsa satır üretilir, veri yetersiz sayılır (unavailable değil)", () => {
  const view = buildBenchmarkComparisonView({
    block: null,
    periodId: "1y",
    preferredOrder: ["gold"],
    labels: { gold: "Altın" },
    seriesWindow: {
      fundSeries: [
        { t: 1000, v: 100 },
        { t: 2000, v: 108 },
      ],
      refSeriesByKey: {
        gold: [],
      },
      startT: 1000,
      endT: 2000,
    },
  });

  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0]?.key, "gold");
  assert.equal(view.rows[0]?.hasEnoughData, false);
  assert.equal(view.insufficientDataCount, 1);
  assert.equal(view.unavailableRefs.length, 0);
  assert.equal(view.passedCount + view.behindCount + view.tiedCount, 0);
});

test("series window: makro seri boş olsa bile kıyas bloğunda dönem satırı varsa bloktan beslenir (ör. BIST100)", () => {
  const block = makeBlock({
    bist100: [
      {
        periodId: "1y",
        label: "1 Yıl",
        fundPct: 12.0,
        refPct: 7.5,
        refPolicyDeltaPp: null,
        band: "above",
        diffPct: null,
      },
    ],
  });
  const view = buildBenchmarkComparisonView({
    block,
    periodId: "1y",
    preferredOrder: ["bist100"],
    labels: { bist100: "BIST 100" },
    seriesWindow: {
      fundSeries: [
        { t: 1000, v: 100 },
        { t: 2000, v: 112 },
      ],
      refSeriesByKey: {
        bist100: [],
      },
      startT: 1000,
      endT: 2000,
    },
  });

  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0]?.key, "bist100");
  assert.equal(view.rows[0]?.hasEnoughData, true);
  assert.ok(Math.abs((view.rows[0]?.comparisonDeltaPct ?? 0) - 4.5) < 1e-9);
  assert.equal(view.rows[0]?.fundReturnPct, 12.0);
  assert.equal(view.rows[0]?.referenceReturnPct, 7.5);
});

test("series window: date range değişince summary yeniden hesaplanır", () => {
  const commonInput = {
    block: null,
    periodId: "1y" as const,
    preferredOrder: ["eurtry"] as const,
    labels: { eurtry: "EUR/TRY" },
    seriesWindow: {
      fundSeries: [
        { t: 1000, v: 100 },
        { t: 1500, v: 110 },
        { t: 2000, v: 120 },
      ],
      refSeriesByKey: {
        eurtry: [
          { t: 1000, v: 100 },
          { t: 1500, v: 108 },
          { t: 2000, v: 112 },
        ],
      },
      startT: 1000,
      endT: 2000,
    },
  };

  const fullRange = buildBenchmarkComparisonView(commonInput);
  const shortRange = buildBenchmarkComparisonView({
    ...commonInput,
    seriesWindow: {
      ...commonInput.seriesWindow,
      startT: 1500,
      endT: 2000,
    },
  });

  assert.notEqual(fullRange.rows[0]?.comparisonDeltaPct, shortRange.rows[0]?.comparisonDeltaPct);
});

test("series window: seçili referans primary row olur ve en güçlü ayrışma max delta ile seçilir", () => {
  const view = buildBenchmarkComparisonView({
    block: null,
    periodId: "1y",
    selectedRef: "gold",
    preferredOrder: ["usdtry", "gold"],
    labels: { usdtry: "USD/TRY", gold: "Altın" },
    seriesWindow: {
      fundSeries: [
        { t: 1000, v: 100 },
        { t: 2000, v: 120 },
      ],
      refSeriesByKey: {
        usdtry: [
          { t: 1000, v: 100 },
          { t: 2000, v: 119 },
        ],
        gold: [
          { t: 1000, v: 100 },
          { t: 2000, v: 108 },
        ],
      },
      startT: 1000,
      endT: 2000,
    },
  });

  assert.equal(view.primaryRow?.key, "gold");
  assert.equal(view.strongestRow?.key, "gold");
});

test("series window: en güçlü pozitif ve negatif ayrışma ayrı hesaplanır", () => {
  const view = buildBenchmarkComparisonView({
    block: null,
    periodId: "1y",
    preferredOrder: ["bist100", "usdtry", "gold"],
    labels: { bist100: "BIST 100", usdtry: "USD/TRY", gold: "Altın" },
    seriesWindow: {
      fundSeries: [
        { t: 1000, v: 100 },
        { t: 2000, v: 120 },
      ],
      refSeriesByKey: {
        bist100: [
          { t: 1000, v: 100 },
          { t: 2000, v: 108 },
        ],
        usdtry: [
          { t: 1000, v: 100 },
          { t: 2000, v: 124 },
        ],
        gold: [
          { t: 1000, v: 100 },
          { t: 2000, v: 116 },
        ],
      },
      startT: 1000,
      endT: 2000,
    },
  });

  assert.equal(view.strongestOutperformRow?.key, "bist100");
  assert.equal(view.strongestUnderperformRow?.key, "usdtry");
});

test("series window: category + BIST100 + USDTRY + EURTRY + Altın + Faiz aynı pipeline'dan hesaplanır", () => {
  const policyLevels = [
    { t: 1000, v: 40 },
    { t: 2000, v: 45 },
  ];
  const expectedPolicyBench = kiyasPolicyReturnPctForWindow(policyLevels, 1000, 2000);
  assert.ok(expectedPolicyBench != null);

  const view = buildBenchmarkComparisonView({
    block: null,
    periodId: "1y",
    preferredOrder: ["category", "bist100", "usdtry", "eurtry", "gold", "policy"],
    labels: {
      category: "Kategori Ortalaması",
      bist100: "BIST 100",
      usdtry: "USD/TRY",
      eurtry: "EUR/TRY",
      gold: "Altın",
      policy: "Faiz / Para Piyasası Eşiği",
    },
    seriesWindow: {
      fundSeries: [
        { t: 1000, v: 100 },
        { t: 2000, v: 120 },
      ],
      refSeriesByKey: {
        category: [
          { t: 1000, v: 100 },
          { t: 2000, v: 112 },
        ],
        bist100: [
          { t: 1000, v: 100 },
          { t: 2000, v: 109 },
        ],
        usdtry: [
          { t: 1000, v: 100 },
          { t: 2000, v: 115 },
        ],
        eurtry: [
          { t: 1000, v: 100 },
          { t: 2000, v: 111 },
        ],
        gold: [
          { t: 1000, v: 100 },
          { t: 2000, v: 118 },
        ],
        policy: policyLevels,
      },
      startT: 1000,
      endT: 2000,
    },
  });

  assert.equal(view.rows.length, 6);
  assert.equal(view.unavailableRefs.length, 0);
  assert.ok(Math.abs((view.rows.find((row) => row.key === "category")?.referenceReturnPct ?? 0) - 12) < 1e-9);
  const policyRow = view.rows.find((row) => row.key === "policy");
  assert.ok(policyRow != null);
  assert.ok(Math.abs(policyRow.referenceReturnPct - (expectedPolicyBench ?? 0)) < 1e-6);
  const naiveRatioPct = (45 / 40 - 1) * 100;
  assert.ok(Math.abs(policyRow.referenceReturnPct - naiveRatioPct) > 0.01);
});

test("farklı referans serileri farklı benchmark getirisi üretir", () => {
  const view = buildBenchmarkComparisonView({
    block: null,
    periodId: "1y",
    preferredOrder: ["bist100", "usdtry"],
    labels: { bist100: "BIST", usdtry: "USD" },
    seriesWindow: {
      fundSeries: [
        { t: 1000, v: 100 },
        { t: 2000, v: 120 },
      ],
      refSeriesByKey: {
        bist100: [
          { t: 1000, v: 100 },
          { t: 2000, v: 105 },
        ],
        usdtry: [
          { t: 1000, v: 100 },
          { t: 2000, v: 130 },
        ],
      },
      startT: 1000,
      endT: 2000,
    },
  });
  assert.equal(view.rows.length, 2);
  assert.notEqual(view.rows[0]!.referenceReturnPct, view.rows[1]!.referenceReturnPct);
  assert.ok(Math.abs((view.rows.find((r) => r.key === "bist100")?.comparisonDeltaPct ?? 0) - 15) < 1e-9);
  assert.ok(Math.abs((view.rows.find((r) => r.key === "usdtry")?.comparisonDeltaPct ?? 0) - (-10)) < 1e-9);
});

test("özet sayıları ile kıyaslanabilir satır sayısı ve summarizeBenchmarkComparisonViewForDev uyumlu", () => {
  const view = buildBenchmarkComparisonView({
    block: null,
    periodId: "1y",
    preferredOrder: ["bist100", "usdtry", "gold"],
    labels: { bist100: "BIST", usdtry: "USD", gold: "Altın" },
    seriesWindow: {
      fundSeries: [
        { t: 1000, v: 100 },
        { t: 2000, v: 110 },
      ],
      refSeriesByKey: {
        bist100: [
          { t: 1000, v: 100 },
          { t: 2000, v: 105 },
        ],
        usdtry: [
          { t: 1000, v: 100 },
          { t: 2000, v: 108 },
        ],
        gold: [],
      },
      startT: 1000,
      endT: 2000,
    },
  });
  const comparable = view.passedCount + view.behindCount + view.tiedCount;
  const okRows = view.rows.filter((r) => r.hasEnoughData && r.comparisonDeltaPct != null).length;
  assert.equal(comparable, okRows);
  assert.equal(view.insufficientDataCount, 1);
  const dev = summarizeBenchmarkComparisonViewForDev(view);
  assert.equal(dev.comparableCount, comparable);
  assert.equal(dev.rows.length, view.rows.length);
});

test("series window: seçili referansta veri yoksa primary ilk yeterli satırdan seçilir", () => {
  const view = buildBenchmarkComparisonView({
    block: null,
    periodId: "1y",
    selectedRef: "usdtry",
    preferredOrder: ["usdtry", "bist100"],
    labels: { usdtry: "USD/TRY", bist100: "BIST 100" },
    seriesWindow: {
      fundSeries: [
        { t: 1000, v: 100 },
        { t: 2000, v: 120 },
      ],
      refSeriesByKey: {
        usdtry: [],
        bist100: [
          { t: 1000, v: 100 },
          { t: 2000, v: 110 },
        ],
      },
      startT: 1000,
      endT: 2000,
    },
  });
  assert.equal(view.primaryRow?.key, "bist100");
});

test("eşik sınırında outperform (delta > 0,15 pp)", () => {
  const view = buildBenchmarkComparisonView({
    block: makeBlock({
      gold: [
        {
          periodId: "1y",
          label: "1 Yıl",
          fundPct: 10.2,
          refPct: 10.0,
          refPolicyDeltaPp: null,
          band: "near",
          diffPct: null,
        },
      ],
    }),
    periodId: "1y",
    preferredOrder: ["gold"],
  });
  assert.equal(view.rows[0]!.outcome, "outperform");
});

test("eşik sınırında neutral (|delta| ≤ 0,15 pp)", () => {
  const view = buildBenchmarkComparisonView({
    block: makeBlock({
      gold: [
        {
          periodId: "1y",
          label: "1 Yıl",
          fundPct: 10.1,
          refPct: 10.0,
          refPolicyDeltaPp: null,
          band: "near",
          diffPct: null,
        },
      ],
    }),
    periodId: "1y",
    preferredOrder: ["gold"],
  });
  assert.equal(view.rows[0]!.outcome, "neutral");
});

test("series window: referansın tüm noktaları pencereden önceyse yanlış %0 üretmez; satır veri yetersiz kalır", () => {
  const view = buildBenchmarkComparisonView({
    block: null,
    periodId: "1y",
    preferredOrder: ["bist100"],
    labels: { bist100: "BIST 100" },
    seriesWindow: {
      fundSeries: [
        { t: 1000, v: 100 },
        { t: 2000, v: 200 },
      ],
      refSeriesByKey: {
        bist100: [
          { t: 100, v: 50 },
          { t: 500, v: 50 },
        ],
      },
      startT: 1000,
      endT: 2000,
    },
  });

  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0]?.key, "bist100");
  assert.equal(view.rows[0]?.hasEnoughData, false);
  assert.equal(view.rows[0]?.comparisonDeltaPct, null);
  assert.equal(view.unavailableRefs.length, 0);
});

test("series window: referansta iki uç indeksi farklı ve değer düzse gerçek %0 satırı üretilir", () => {
  const view = buildBenchmarkComparisonView({
    block: null,
    periodId: "1y",
    preferredOrder: ["gold"],
    labels: { gold: "Altın" },
    seriesWindow: {
      fundSeries: [
        { t: 1000, v: 100 },
        { t: 2000, v: 120 },
      ],
      refSeriesByKey: {
        gold: [
          { t: 1000, v: 100 },
          { t: 2000, v: 100 },
        ],
      },
      startT: 1000,
      endT: 2000,
    },
  });

  assert.equal(view.rows.length, 1);
  assert.ok(Math.abs(view.rows[0]!.referenceReturnPct) < 1e-9);
  assert.ok(Math.abs(view.rows[0]!.fundReturnPct - 20) < 1e-9);
});

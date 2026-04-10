import test from "node:test";
import assert from "node:assert/strict";
import { buildBenchmarkComparisonView } from "@/lib/fund-detail-comparison";
import type { FundKiyasViewPayload } from "@/lib/services/fund-detail-kiyas.service";

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
  assert.equal(view.rows[0]!.benchmarkReturn, 18.1);
  assert.ok(Math.abs(view.rows[0]!.difference - 8.45) < 1e-9);
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

  assert.ok(Math.abs(view.rows[0]!.difference + 13.75) < 1e-9);
  assert.equal(view.rows[0]!.outcome, "underperform");
});

test("eşit/çok yakın durumda neutral döner", () => {
  const view = buildBenchmarkComparisonView({
    block: makeBlock({
      usdtry: [
        {
          periodId: "1y",
          label: "1 Yıl",
          fundPct: 10.01,
          refPct: 10.0,
          refPolicyDeltaPp: null,
          band: "near",
          diffPct: null,
        },
      ],
    }),
    periodId: "1y",
    preferredOrder: ["usdtry"],
    nearEps: 0.15,
  });

  assert.ok(Math.abs(view.rows[0]!.difference - 0.01) < 1e-9);
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

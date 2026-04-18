import test from "node:test";
import assert from "node:assert/strict";
import { orchestrateDetailPayload } from "@/lib/services/fund-detail-orchestrator";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

function makePayload(overrides?: Partial<FundDetailPageData>): FundDetailPageData {
  const base: FundDetailPageData = {
    fund: {
      code: "AAA",
      name: "A Fund",
      shortName: "A",
      description: null,
      lastPrice: 10,
      dailyReturn: 1,
      weeklyReturn: 2,
      monthlyReturn: 3,
      yearlyReturn: 4,
      portfolioSize: 1000,
      investorCount: 100,
      category: { code: "CAT", name: "Kategori" },
      fundType: { code: 1, name: "Tip" },
      logoUrl: null,
      lastUpdatedAt: null,
      updatedAt: new Date().toISOString(),
      portfolioManagerInferred: null,
    },
    snapshotDate: "2026-04-17",
    snapshotAlpha: null,
    riskLevel: null,
    snapshotMetrics: null,
    priceSeries: Array.from({ length: 150 }, (_, index) => ({ t: 1_700_000_000_000 + index * 86_400_000, p: 10 + index })),
    historyMetrics: null,
    bestWorstDay: null,
    modelBenchmark: null,
    tradingCurrency: "TRY",
    derivedSummary: {
      periodReturnPct: null,
      returnApprox1YearPct: null,
      returnApprox3YearPct: null,
      annualizedVolatilityPct: null,
      maxDrawdownPct: null,
      sharpeApprox: null,
      betaApprox: null,
      alphaApprox: null,
      informationRatioApprox: null,
      downsideVolatilityPct: null,
      upsideCapturePct: null,
      downsideCapturePct: null,
      winRatePct: null,
      averageMonthlyReturnPct: null,
      positiveMonths: null,
      negativeMonths: null,
    },
    similarFunds: [{ code: "BBB", name: "B Fund", shortName: "B", lastPrice: 12, dailyReturn: 1, logoUrl: null }],
    similarCategoryPeerDailyReturns: [],
    categoryReturnAverages: null,
    kiyasBlock: {
      refs: [{ code: "XU100", label: "BIST 100", kind: "macro" }],
      rowsByRef: {
        XU100: [{ periodId: "1y", fundPct: 20, refPct: 10, deltaPct: 10, outcome: "outperform" }],
      },
    },
    trendSeries: {
      portfolioSize: [{ t: 1_700_000_000_000, v: 10 }, { t: 1_700_086_400_000, v: 11 }],
      investorCount: [{ t: 1_700_000_000_000, v: 10 }, { t: 1_700_086_400_000, v: 11 }],
    },
  };
  return { ...base, ...overrides };
}

test("detail orchestrator marks insufficient long horizon as invalid", () => {
  const payload = makePayload({ priceSeries: [{ t: 1, p: 10 }, { t: 2, p: 11 }] });
  const out = orchestrateDetailPayload(payload);
  assert.equal(out.overall.reliabilityClass, "invalid_insufficient");
  assert.equal(out.sectionHealth.chartHealth, "invalid");
});

test("detail orchestrator keeps healthy payload trusted", () => {
  const out = orchestrateDetailPayload(makePayload());
  assert.equal(out.overall.reliabilityClass, "current");
  assert.equal(out.overall.trustAsFinal, true);
  assert.equal(out.overall.overallDetailHealth, "healthy");
  assert.equal(out.sectionHealth.profileHealth, "healthy");
});

test("detail orchestrator forces low-data policy into untrusted final", () => {
  const out = orchestrateDetailPayload(
    makePayload({
      priceSeries: Array.from({ length: 10 }, (_, index) => ({ t: 1_700_000_000_000 + index * 86_400_000, p: 10 + index })),
    })
  );
  assert.equal(out.overall.trustAsFinal, false);
  assert.equal(out.payload.degraded?.reasons.includes("low_data_policy_insufficient"), true);
});

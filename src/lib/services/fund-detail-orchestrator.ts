import {
  evaluateDetailReliability,
  healthFromReliabilityClass,
  horizonValidityFromSeries,
  normalizeReliabilityDecision,
  reliabilitySourceFromDetailReasons,
  type FundDataReliabilityClass,
  type HealthState,
} from "@/lib/fund-data-reliability";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

const MIN_POINTS_1Y = 42;
const MIN_POINTS_3Y = 126;

export type DetailSectionHealth = {
  chartHealth: HealthState;
  investorTrendHealth: HealthState;
  fundSizeTrendHealth: HealthState;
  compareHealth: HealthState;
  alternativesHealth: HealthState;
};

export type DetailOverallHealth = {
  overallDetailHealth: HealthState;
  trustAsFinal: boolean;
  reliabilityClass: FundDataReliabilityClass;
  reasons: string[];
};

export type DetailOrchestrationOutput = {
  payload: FundDetailPageData;
  sectionHealth: DetailSectionHealth;
  overall: DetailOverallHealth;
};

function hasMeaningfulAlternatives(payload: FundDetailPageData): boolean {
  const selfCode = payload.fund.code.trim().toUpperCase();
  return payload.similarFunds.some((item) => {
    const code = item.code?.trim().toUpperCase();
    return Boolean(code && code !== selfCode);
  });
}

function countValidComparisonRows(payload: FundDetailPageData): number {
  if (!payload.kiyasBlock) return 0;
  return Object.values(payload.kiyasBlock.rowsByRef).reduce((sum, rows) => {
    const row = rows.find((item) => item.periodId === "1y");
    if (!row) return sum;
    const valid = Number.isFinite(row.fundPct) && Number.isFinite(row.refPct);
    return sum + (valid ? 1 : 0);
  }, 0);
}

function rollupHealth(values: HealthState[]): HealthState {
  if (values.some((item) => item === "invalid")) return "invalid";
  if (values.some((item) => item === "degraded")) return "degraded";
  return "healthy";
}

export function orchestrateDetailPayload(rawPayload: FundDetailPageData): DetailOrchestrationOutput {
  const payload = { ...rawPayload };
  const reasons = payload.degraded?.reasons ?? [];
  const stale = Boolean(payload.degraded?.stale);
  const failedSteps = payload.degraded?.failedSteps ?? [];
  const sourceTier = reliabilitySourceFromDetailReasons(reasons);

  const horizon1Y = horizonValidityFromSeries(payload.priceSeries.length, MIN_POINTS_1Y, stale);
  const horizon3Y = horizonValidityFromSeries(payload.priceSeries.length, MIN_POINTS_3Y, stale);
  const horizonReasons: string[] = [];
  if (horizon1Y !== "valid") horizonReasons.push(`horizon_1y_${horizon1Y}`);
  if (horizon3Y !== "valid") horizonReasons.push(`horizon_3y_${horizon3Y}`);
  const horizonInvalid = horizon1Y === "too_short" || horizon3Y === "too_short";

  const decision = normalizeReliabilityDecision(
    evaluateDetailReliability({
      sourceTier,
      hasCoreSeries: payload.priceSeries.length >= 2 && !horizonInvalid,
      hasTrendSeries:
        payload.trendSeries.investorCount.length >= 2 || payload.trendSeries.portfolioSize.length >= 2,
      hasComparison: countValidComparisonRows(payload) > 0,
      hasMeaningfulAlternatives: hasMeaningfulAlternatives(payload),
      stale,
      partial: Boolean(payload.degraded?.partial),
      reasons: [...reasons, ...horizonReasons],
      failedSteps,
    })
  );

  const sectionHealth: DetailSectionHealth = {
    chartHealth: healthFromReliabilityClass(
      payload.priceSeries.length >= MIN_POINTS_1Y ? "current" : "invalid_insufficient"
    ),
    investorTrendHealth: healthFromReliabilityClass(
      payload.trendSeries.investorCount.length >= 2 ? "current" : "invalid_insufficient"
    ),
    fundSizeTrendHealth: healthFromReliabilityClass(
      payload.trendSeries.portfolioSize.length >= 2 ? "current" : "invalid_insufficient"
    ),
    compareHealth: healthFromReliabilityClass(
      countValidComparisonRows(payload) > 0 ? "current" : "invalid_insufficient"
    ),
    alternativesHealth: healthFromReliabilityClass(
      hasMeaningfulAlternatives(payload) ? "current" : "invalid_insufficient"
    ),
  };

  const overallDetailHealth = rollupHealth(Object.values(sectionHealth));
  payload.degraded = {
    active: decision.class === "degraded" || decision.class === "invalid_insufficient",
    stale,
    partial: decision.class !== "current",
    reasons: decision.reasons,
    failedSteps,
    generatedAt: payload.degraded?.generatedAt ?? new Date().toISOString(),
    reliabilityClass: decision.class,
    canTrustAsFinal: decision.canPresentAsTrustedFinalState && overallDetailHealth === "healthy",
    sourceTier: decision.sourceTier,
  };

  return {
    payload,
    sectionHealth,
    overall: {
      overallDetailHealth,
      trustAsFinal: payload.degraded.canTrustAsFinal ?? false,
      reliabilityClass: decision.class,
      reasons: decision.reasons,
    },
  };
}

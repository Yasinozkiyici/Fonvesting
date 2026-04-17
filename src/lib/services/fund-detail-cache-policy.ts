import { deriveFundDetailSectionStates } from "@/lib/fund-detail-section-status";
import {
  evaluateDetailReliability,
  reliabilitySourceFromDetailReasons,
  type FundDataReliabilityClass,
} from "@/lib/fund-data-reliability";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

export type DetailCacheKind = "core_full" | "core_degraded" | "full_optional_enriched" | "emergency";

export type DetailCacheEntryLike = {
  payload: FundDetailPageData;
  kind: DetailCacheKind;
};

export type DetailCachePolicyOptions = {
  freshTtlMs: number;
  staleTtlMs: number;
  degradedFreshTtlMs: number;
  degradedStaleTtlMs: number;
  emergencyFreshTtlMs: number;
  emergencyStaleTtlMs: number;
  chartPartialMinPoints: number;
};

export function resolveDetailCachePolicy(
  kind: DetailCacheKind,
  options: DetailCachePolicyOptions
): { freshTtlMs: number; staleTtlMs: number } {
  if (kind === "emergency") {
    return { freshTtlMs: options.emergencyFreshTtlMs, staleTtlMs: options.emergencyStaleTtlMs };
  }
  if (kind === "core_degraded") {
    return { freshTtlMs: options.degradedFreshTtlMs, staleTtlMs: options.degradedStaleTtlMs };
  }
  return { freshTtlMs: options.freshTtlMs, staleTtlMs: options.staleTtlMs };
}

function hasRequiredCoreData(payload: FundDetailPageData): boolean {
  return (
    typeof payload.snapshotDate === "string" &&
    payload.snapshotDate.length > 0 &&
    Number.isFinite(payload.fund.lastPrice) &&
    payload.fund.lastPrice > 0 &&
    Number.isFinite(payload.fund.investorCount) &&
    payload.fund.investorCount > 0 &&
    Number.isFinite(payload.fund.portfolioSize) &&
    payload.fund.portfolioSize > 0 &&
    payload.priceSeries.length >= 2 &&
    payload.trendSeries.investorCount.length >= 2 &&
    payload.trendSeries.portfolioSize.length >= 2
  );
}

function hasMeaningfulAlternatives(payload: FundDetailPageData): boolean {
  const ownCode = payload.fund.code.trim().toUpperCase();
  return payload.similarFunds.some((item) => {
    const code = item.code?.trim().toUpperCase();
    if (!code || code === ownCode) return false;
    return Boolean(item.name?.trim() || item.shortName?.trim());
  });
}

function countValidComparisonRefs(payload: FundDetailPageData): number {
  const rowsByRef = payload.kiyasBlock?.rowsByRef;
  if (!rowsByRef) return 0;
  let valid = 0;
  for (const rows of Object.values(rowsByRef)) {
    const row = rows.find((item) => item.periodId === "1y");
    if (!row) continue;
    if (typeof row.fundPct === "number" && Number.isFinite(row.fundPct) && typeof row.refPct === "number" && Number.isFinite(row.refPct)) {
      valid += 1;
    }
  }
  return valid;
}

function cacheKindPriority(kind: DetailCacheKind): number {
  if (kind === "full_optional_enriched") return 4;
  if (kind === "core_full") return 3;
  if (kind === "core_degraded") return 2;
  return 1;
}

function sectionStateRank(state: "full" | "partial" | "no_data"): number {
  if (state === "full") return 3;
  if (state === "partial") return 2;
  return 1;
}

function payloadCacheQualityScore(payload: FundDetailPageData): number {
  const sections = deriveFundDetailSectionStates(payload);
  const comparisonRefs = payload.kiyasBlock?.refs.length ?? 0;
  const reasons = payload.degraded?.reasons ?? [];
  const syntheticSeriesPenalty = reasons.includes("history_serving_synthetic_extension") ? 2_500 : 0;
  return (
    sectionStateRank(sections.performance) * 10_000 +
    sectionStateRank(sections.trends) * 4_500 +
    sectionStateRank(sections.comparison) * 2_000 +
    payload.priceSeries.length * 15 +
    payload.trendSeries.investorCount.length * 8 +
    payload.trendSeries.portfolioSize.length * 8 +
    comparisonRefs * 40 -
    syntheticSeriesPenalty
  );
}

export function inferDetailCacheKind(
  payload: FundDetailPageData,
  deps: {
    hasOptionalEnrichment: (payload: FundDetailPageData) => boolean;
    needsPhase2OptionalRefresh: (payload: FundDetailPageData) => boolean;
  },
  options: Pick<DetailCachePolicyOptions, "chartPartialMinPoints">
): DetailCacheKind {
  const reasons = payload.degraded?.reasons ?? [];
  const hasEmergencyReason = reasons.some((reason) => reason.includes("emergency"));
  if (hasEmergencyReason || (!payload.snapshotDate && payload.priceSeries.length === 0)) {
    return "emergency";
  }
  const sectionStates = deriveFundDetailSectionStates(payload);
  const coreHealthy =
    sectionStates.performance === "full" &&
    sectionStates.trends !== "no_data" &&
    payload.priceSeries.length >= options.chartPartialMinPoints;
  const optionalRefreshNeeded = deps.needsPhase2OptionalRefresh(payload);
  if (deps.hasOptionalEnrichment(payload) && !optionalRefreshNeeded && !payload.degraded?.active && coreHealthy) {
    return "full_optional_enriched";
  }
  if (!coreHealthy) return "core_degraded";
  if (hasRequiredCoreData(payload)) return payload.degraded?.active ? "core_degraded" : "core_full";
  return "core_degraded";
}

export function shouldWriteDetailCache(
  existing: DetailCacheEntryLike | undefined,
  incoming: DetailCacheKind,
  incomingPayload: FundDetailPageData
): boolean {
  if (!existing) return true;
  const incomingSnapshotTs = incomingPayload.snapshotDate ? new Date(incomingPayload.snapshotDate).getTime() : Number.NaN;
  const existingSnapshotTs = existing.payload.snapshotDate ? new Date(existing.payload.snapshotDate).getTime() : Number.NaN;
  const incomingSnapshotOk = Number.isFinite(incomingSnapshotTs);
  const existingSnapshotOk = Number.isFinite(existingSnapshotTs);
  if (incomingSnapshotOk && existingSnapshotOk) {
    if (incomingSnapshotTs > existingSnapshotTs) return true;
    if (incomingSnapshotTs < existingSnapshotTs) return false;
  } else if (incomingSnapshotOk && !existingSnapshotOk) {
    return true;
  } else if (!incomingSnapshotOk && existingSnapshotOk) {
    return false;
  }
  const incomingPriority = cacheKindPriority(incoming);
  const existingPriority = cacheKindPriority(existing.kind);
  if (incomingPriority > existingPriority) return true;
  if (incomingPriority < existingPriority) return false;
  return payloadCacheQualityScore(incomingPayload) >= payloadCacheQualityScore(existing.payload);
}

function isNonBlockingDetailDegradedReason(reason: string): boolean {
  if (reason.startsWith("core_price_series_source_")) return true;
  return (
    reason === "core_investor_trend_missing" ||
    reason === "core_portfolio_trend_missing" ||
    reason === "core_investor_current_missing" ||
    reason === "core_portfolio_current_missing" ||
    reason === "history_series_quality_partial" ||
    reason === "history_serving_insufficient_coverage" ||
    reason === "history_serving_insufficient_points" ||
    reason === "history_serving_sparse_mode" ||
    reason === "history_serving_quality_below_full" ||
    reason === "history_serving_no_live_rows"
  );
}

function hasMaterialDetailDegradeSignals(reasons: string[], failedSteps: string[]): boolean {
  if (failedSteps.length > 0) return true;
  return reasons.some((item) => !isNonBlockingDetailDegradedReason(item));
}

export function withDetailDegradedPayload(
  payload: FundDetailPageData,
  input: { stale: boolean; partial: boolean; reasons: string[]; failedSteps: string[] }
): FundDetailPageData {
  const material = hasMaterialDetailDegradeSignals(input.reasons, input.failedSteps);
  const reliability = evaluateDetailReliability({
    sourceTier: reliabilitySourceFromDetailReasons(input.reasons),
    hasCoreSeries: payload.priceSeries.length >= 2,
    hasTrendSeries:
      payload.trendSeries.investorCount.length >= 2 || payload.trendSeries.portfolioSize.length >= 2,
    hasComparison: countValidComparisonRefs(payload) > 0,
    hasMeaningfulAlternatives: hasMeaningfulAlternatives(payload),
    stale: input.stale,
    partial: input.partial,
    reasons: input.reasons,
    failedSteps: input.failedSteps,
  });
  return {
    ...payload,
    degraded: {
      active: material,
      stale: input.stale,
      partial: material && input.partial,
      reasons: input.reasons,
      failedSteps: input.failedSteps,
      generatedAt: new Date().toISOString(),
      reliabilityClass: reliability.class as FundDataReliabilityClass,
      canTrustAsFinal: reliability.canPresentAsTrustedFinalState,
      sourceTier: reliability.sourceTier,
    },
  };
}

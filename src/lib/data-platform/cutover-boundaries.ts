export const DATA_PLATFORM_CUTOVER_PHASE = "phase1" as const;

/**
 * Phase 1 hard boundaries:
 * - Only these contracts can own runtime truth.
 * - Legacy sources may exist temporarily, but only as passive fallback.
 */
export const CANONICAL_TRUTH_BOUNDARIES = {
  runLedger: "sync_log.daily_sync.errorMessage(schemaVersion=v2)",
  normalizedSnapshot: "fund_daily_snapshot(date desc)",
  servingPublish: "serving_fund_list/serving_fund_detail/serving_compare_inputs build alignment",
  chartPublish: "run_ledger.chartPublish stage",
  comparisonPublish: "run_ledger.returnComparisonPublish stage",
  freshnessTruth: "readFreshnessTruthCached()",
} as const;

/**
 * Explicit replacement targets for later cutover phases.
 */
export const CUTOVER_REPLACEMENT_SURFACES = {
  homepageDiscoveryReadPath: "/api/funds/scores + /api/funds + /api/market",
  scoresReadPath: "/api/funds/scores",
  detailReadPath: "/fund/[code] + fund-detail.service",
  charts: "FundDetailChart + /api/funds/compare-series",
  returnComparison: "/api/funds/compare + detail comparison block",
  healthAndReleaseGates: "/api/health + scripts/data-platform/release-gate.mjs",
} as const;

export type CanonicalTruthBoundaryKey = keyof typeof CANONICAL_TRUTH_BOUNDARIES;
export type CutoverReplacementSurfaceKey = keyof typeof CUTOVER_REPLACEMENT_SURFACES;

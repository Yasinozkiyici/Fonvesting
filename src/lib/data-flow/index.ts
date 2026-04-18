export type {
  CompareSurfaceState,
  DetailSurfaceState,
  HomepageDiscoverySurfaceState,
  HomepageTotalsSemanticContract,
} from "@/lib/data-flow/contracts";
export { logHomepageDataFlowEvidence } from "@/lib/data-flow/diagnostics";
export {
  normalizeCompareApiBoundary,
  resolveCompareSurfaceState,
  type CompareBoundaryResult,
} from "@/lib/data-flow/compare-boundary";
export {
  normalizeFundDetailPayloadAtBoundary,
  type DetailBoundaryResult,
} from "@/lib/data-flow/detail-boundary";
export {
  deriveHomepageDiscoverySurfaceState,
  prepareHomepageCategoriesForClient,
  prepareHomepageScoresPreviewAtBoundary,
} from "@/lib/data-flow/homepage-boundary";
export { normalizeHomepageCategoryList, type HomepageCategoryOption } from "@/lib/data-flow/normalize/homepage-categories";

/**
 * Faz 1 — kanonik sözleşme yüzeyi: keşif, spotlight, kıyas, tazelik.
 * Özellik kodları `@/lib/contracts/...` alt modüllerinden içe aktarmalıdır.
 */
export type { DiscoveryScopeInput } from "@/lib/contracts/discovery-scope";
export type {
  DiscoveryPayloadContract,
  DiscoveryScopeAlignment,
  DiscoverySourceQuality,
} from "@/lib/contracts/discovery-payload-contract";
export {
  buildDiscoveryPayloadContract,
  isDiscoveryPayloadContract,
  mapDiscoverySourceToQuality,
  scopeAlignmentFromScopeHealth,
} from "@/lib/contracts/discovery-payload-contract";
export type { DiscoverySurfaceState } from "@/lib/contracts/discovery-surface-state";
export { deriveDiscoverySurfaceState } from "@/lib/contracts/discovery-surface-state";
export type { SpotlightContract, SpotlightReason } from "@/lib/contracts/spotlight-contract";
export { deriveSpotlightContract } from "@/lib/contracts/spotlight-contract";
export type { ComparisonRenderContract, ComparisonRenderReason } from "@/lib/contracts/comparison-render-contract";
export {
  countComparisonReferenceRows,
  deriveComparisonRenderContract,
  resolveFundDetailComparisonShouldRender,
} from "@/lib/contracts/comparison-render-contract";

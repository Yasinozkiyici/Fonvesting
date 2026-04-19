import type { DiscoveryPayloadContract } from "@/lib/contracts/discovery-payload-contract";
import type { ScoredFund } from "@/types/scored-funds";
import type { DiscoverySurfaceState } from "@/lib/contracts/discovery-surface-state";

export type SpotlightReason =
  | "spotlight_ready"
  | "no_scope_matches"
  | "scope_degraded"
  | "ranking_unavailable"
  | "source_unavailable"
  | "spotlight_loading"
  | "spotlight_scope_idle";

/**
 * Öne çıkan üçlü: keşif sözleşmesi ile aynı kapsamdan türetilir; bağımsız tahmin yok.
 */
export type SpotlightContract = {
  enabled: boolean;
  renderable: boolean;
  reason: SpotlightReason;
  /** Kartlar her zaman discoveryContract.scope ile uyumlu veri kümesinden seçilir */
  derivedFromSameScope: true;
  cardCount: number;
};

export function deriveSpotlightContract(input: {
  discoveryActive: boolean;
  discoverySurface: DiscoverySurfaceState;
  discoveryContract: DiscoveryPayloadContract | null;
  spotlightFunds: ScoredFund[];
}): SpotlightContract {
  if (!input.discoveryActive) {
    return {
      enabled: false,
      renderable: false,
      reason: "spotlight_scope_idle",
      derivedFromSameScope: true,
      cardCount: 0,
    };
  }
  if (input.discoverySurface === "loading_initial" || input.discoverySurface === "loading_refresh") {
    return {
      enabled: true,
      renderable: false,
      reason: "spotlight_loading",
      derivedFromSameScope: true,
      cardCount: 0,
    };
  }
  if (
    input.discoverySurface === "error" ||
    input.discoverySurface === "degraded_scoped"
  ) {
    return {
      enabled: true,
      renderable: false,
      reason: "scope_degraded",
      derivedFromSameScope: true,
      cardCount: 0,
    };
  }
  if (!input.discoveryContract) {
    return {
      enabled: true,
      renderable: false,
      reason: "source_unavailable",
      derivedFromSameScope: true,
      cardCount: 0,
    };
  }
  if (input.discoveryContract.matchedTotal <= 0) {
    return {
      enabled: true,
      renderable: false,
      reason: "no_scope_matches",
      derivedFromSameScope: true,
      cardCount: 0,
    };
  }
  const n = input.spotlightFunds.length;
  if (n === 0) {
    return {
      enabled: true,
      renderable: false,
      reason: "ranking_unavailable",
      derivedFromSameScope: true,
      cardCount: 0,
    };
  }
  return {
    enabled: true,
    renderable: true,
    reason: "spotlight_ready",
    derivedFromSameScope: true,
    cardCount: Math.min(3, n),
  };
}

import type { ScoresApiPayload } from "@/lib/services/fund-scores-types";
import type { DiscoveryScopeInput } from "@/lib/contracts/discovery-scope";
import type { HealthState } from "@/lib/fund-data-reliability";

/** Sunucunun skor/satır üretim yolu kalitesi (tek sınıflandırma). */
export type DiscoverySourceQuality =
  | "serving_final"
  | "serving_degraded"
  | "fallback"
  | "empty"
  | "memory_cache";

/** Scope ile satır içeriğinin sözleşmeye uyumu (discovery health ile uyumlu). */
export type DiscoveryScopeAlignment = "aligned" | "misaligned" | "unknown";

/**
 * Keşif yanıtı için tek kanonik sözleşme: toplamlar ve hizalama burada biter.
 * İstemci bu alan varken total/matchedTotal için başka çıkarım yapmaz.
 */
export type DiscoveryPayloadContract = {
  scope: DiscoveryScopeInput;
  universeTotal: number;
  matchedTotal: number;
  returnedCount: number;
  scopeAlignment: DiscoveryScopeAlignment;
  sourceQuality: DiscoverySourceQuality;
  degradedReason: string | null;
  /** Ham kaynak etiketi (gözlem / log); sourceQuality üstünde tek doğruluk yok. */
  discoverySource: string;
};

export function mapDiscoverySourceToQuality(
  discoverySource: string,
  trustAsFinal: boolean
): DiscoverySourceQuality {
  if (discoverySource === "memory") return "memory_cache";
  if (discoverySource === "empty") return "empty";
  if (
    discoverySource === "serving_discovery_index" ||
    discoverySource === "serving_discovery"
  ) {
    return trustAsFinal ? "serving_final" : "serving_degraded";
  }
  return "fallback";
}

export function scopeAlignmentFromScopeHealth(scopeHealth: HealthState): DiscoveryScopeAlignment {
  if (scopeHealth === "healthy") return "aligned";
  return "misaligned";
}

export function isDiscoveryPayloadContract(value: unknown): value is DiscoveryPayloadContract {
  if (!value || typeof value !== "object") return false;
  const v = value as DiscoveryPayloadContract;
  return (
    typeof v.universeTotal === "number" &&
    Number.isFinite(v.universeTotal) &&
    typeof v.matchedTotal === "number" &&
    Number.isFinite(v.matchedTotal) &&
    typeof v.returnedCount === "number" &&
    Number.isFinite(v.returnedCount) &&
    v.scope != null &&
    typeof v.scope === "object"
  );
}

export function buildDiscoveryPayloadContract(input: {
  payload: ScoresApiPayload;
  scope: DiscoveryScopeInput;
  scopeHealth: HealthState;
  discoverySource: string;
  trustAsFinal: boolean;
  degradedReason: string | null;
}): DiscoveryPayloadContract {
  const returnedCount =
    typeof input.payload.returnedCount === "number" && Number.isFinite(input.payload.returnedCount)
      ? input.payload.returnedCount
      : input.payload.funds.length;
  return {
    scope: input.scope,
    universeTotal: input.payload.universeTotal,
    matchedTotal: input.payload.matchedTotal,
    returnedCount,
    scopeAlignment: scopeAlignmentFromScopeHealth(input.scopeHealth),
    sourceQuality: mapDiscoverySourceToQuality(input.discoverySource, input.trustAsFinal),
    degradedReason: input.degradedReason,
    discoverySource: input.discoverySource,
  };
}

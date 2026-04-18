import type { ScoresApiPayload } from "@/lib/services/fund-scores-types";

export type ScoresApiSurfaceState = "ready" | "valid_empty" | "degraded_empty";

export function resolveScoresApiSurfaceState(input: {
  payload: ScoresApiPayload;
  degradedReason: string | null;
}): ScoresApiSurfaceState {
  if (input.payload.funds.length > 0) return "ready";
  return input.degradedReason ? "degraded_empty" : "valid_empty";
}

export function validateScoresApiPayloadContract(payload: ScoresApiPayload): {
  valid: boolean;
  reason: string | null;
} {
  if (!Array.isArray(payload.funds)) return { valid: false, reason: "funds_not_array" };
  const returnedCount = payload.funds.length;
  if (!Number.isFinite(payload.universeTotal) || payload.universeTotal < 0) {
    return { valid: false, reason: "universe_total_invalid" };
  }
  if (!Number.isFinite(payload.total) || payload.total !== payload.universeTotal) {
    return { valid: false, reason: "legacy_total_not_equal_universe_total" };
  }
  if (!Number.isFinite(payload.matchedTotal) || payload.matchedTotal < 0) {
    return { valid: false, reason: "matched_total_invalid" };
  }
  if (payload.matchedTotal > payload.universeTotal) {
    return { valid: false, reason: "matched_total_exceeds_universe_total" };
  }
  if (returnedCount > payload.matchedTotal) {
    return { valid: false, reason: "returned_rows_exceed_matched_total" };
  }
  return { valid: true, reason: null };
}

/**
 * Filter scope sözleşmesi:
 * - filtered payload yoksa toplam null olmalı (sessiz türetim yok)
 * - varsa yalnız matchedTotal kullanılır
 */
export function resolveFilteredScopeTotalOrNull(payload: ScoresApiPayload | null): number | null {
  if (!payload) return null;
  if (!Number.isFinite(payload.matchedTotal)) return null;
  return payload.matchedTotal;
}


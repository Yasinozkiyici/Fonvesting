import type { ScoredResponse } from "@/types/scored-funds";

/** Tam keşif evreni (sunucu kapsamı); eski yanıtlarda yalnızca `total` olabilir. */
export function readScoresUniverseTotal(payload: Pick<ScoredResponse, "universeTotal" | "total">): number {
  if (payload.universeTotal != null && Number.isFinite(payload.universeTotal)) {
    return payload.universeTotal;
  }
  return typeof payload.total === "number" && Number.isFinite(payload.total) ? payload.total : 0;
}

/** Tema + sunucu q sonrası eşleşen sayı. */
export function readScoresMatchedTotal(
  payload: Pick<ScoredResponse, "matchedTotal" | "total" | "funds">
): number {
  if (payload.matchedTotal != null && Number.isFinite(payload.matchedTotal)) {
    return payload.matchedTotal;
  }
  if (typeof payload.total === "number" && Number.isFinite(payload.total)) {
    return payload.total;
  }
  return payload.funds?.length ?? 0;
}

export function readScoresReturnedCount(payload: Pick<ScoredResponse, "returnedCount" | "funds">): number {
  if (payload.returnedCount != null && Number.isFinite(payload.returnedCount)) {
    return payload.returnedCount;
  }
  return payload.funds.length;
}

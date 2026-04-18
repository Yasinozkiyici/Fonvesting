import { readScoresMatchedTotal } from "@/lib/scores-response-counts";
import type { ScoredResponse } from "@/types/scored-funds";

export type HomepageDiscoveryTableSurfaceState =
  | { kind: "loading" }
  | { kind: "error"; reason: string }
  | { kind: "ready" }
  | { kind: "empty_filtered" }
  | { kind: "degraded_empty"; reason: string }
  | { kind: "valid_empty" };

export function deriveHomepageDiscoveryTableSurfaceState(input: {
  loading: boolean;
  bootstrapFallbackActive: boolean;
  error: string | null;
  paginatedCount: number;
  hasFilters: boolean;
  scoresMeta: { degraded: string; emptyResult: string };
}): HomepageDiscoveryTableSurfaceState {
  if (input.loading || input.bootstrapFallbackActive) return { kind: "loading" };
  if (input.error) return { kind: "error", reason: "fetch_or_runtime_error" };
  if (input.paginatedCount > 0) return { kind: "ready" };
  if (input.scoresMeta.emptyResult === "degraded" || Boolean(input.scoresMeta.degraded)) {
    return { kind: "degraded_empty", reason: "degraded_scores_payload" };
  }
  if (input.scoresMeta.emptyResult === "valid") return { kind: "valid_empty" };
  if (input.hasFilters) return { kind: "empty_filtered" };
  return { kind: "degraded_empty", reason: "unknown_empty_without_filters" };
}

/**
 * Freeze owner:
 * - Filtresiz durumda yalnızca kanonik evren toplamı geçerlidir.
 * - Filtreli durumda yalnızca scoped payload matchedTotal geçerlidir.
 * - Satır sayısı / fallback payload / preview satırı asla total yerine kullanılamaz.
 */
export function resolveHomepageRegisteredTotal(input: {
  hasFilters: boolean;
  canonicalUniverseTotal: number | null;
  scopedPayload: ScoredResponse | null;
}): number | null {
  if (!input.hasFilters) return input.canonicalUniverseTotal;
  if (!input.scopedPayload) return null;
  const matched = readScoresMatchedTotal(input.scopedPayload);
  return Number.isFinite(matched) ? matched : null;
}


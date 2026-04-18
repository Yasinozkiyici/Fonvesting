/**
 * Ana sayfa SSR → istemci sınırı: ham payload burada normalize + sınıflanır.
 */
import { normalizeScoredResponse } from "@/lib/client-data";
import type { ScoredResponse } from "@/types/scored-funds";
import type { HomepageDiscoverySurfaceState } from "@/lib/data-flow/contracts";
import { normalizeHomepageCategoryList, type HomepageCategoryOption } from "@/lib/data-flow/normalize/homepage-categories";

export function prepareHomepageScoresPreviewAtBoundary(preview: ScoredResponse | null): ScoredResponse | null {
  if (preview == null) return null;
  const normalized = normalizeScoredResponse(preview as unknown);
  return normalized ?? null;
}

export function prepareHomepageCategoriesForClient(
  raw: ReadonlyArray<{ code?: unknown; name?: unknown }>
): { categories: HomepageCategoryOption[]; rejectedRows: number } {
  return normalizeHomepageCategoryList(raw);
}

export function deriveHomepageDiscoverySurfaceState(input: {
  categoryCount: number;
  scoresPreview: ScoredResponse | null;
  categoryRejectedRows: number;
  /** Normalize öncesi fon satırı sayısı; >0 iken normalize sonrası 0 ise `normalization_removed_all_rows`. */
  preNormalizationFundCount?: number | null;
}): HomepageDiscoverySurfaceState {
  if (input.categoryRejectedRows > 0 && input.categoryCount === 0) {
    return {
      kind: "degraded_invalid_payload",
      reason: "homepage_categories_all_rejected_after_normalization",
    };
  }
  if (input.categoryCount === 0) {
    return { kind: "degraded_missing_categories" };
  }
  if (!input.scoresPreview) {
    return { kind: "degraded_empty_result", reason: "no_scores_payload_after_boundary" };
  }
  if (input.scoresPreview.funds.length === 0) {
    const pre = input.preNormalizationFundCount ?? null;
    if (pre != null && pre > 0) {
      return { kind: "degraded_empty_result", reason: "normalization_removed_all_rows" };
    }
    return { kind: "degraded_empty_result", reason: "empty_scores_row_list" };
  }
  return { kind: "ready" };
}

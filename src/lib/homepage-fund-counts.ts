/**
 * Ana sayfa “toplam fon / keşif evreni” sayıları için tek sözleşme.
 * Önizleme satır sayısı, sayfa boyutu veya serving-core alt kümesi asla “gerçek evren toplamı” olarak kullanılmaz.
 */

import { readScoresUniverseTotal } from "@/lib/scores-response-counts";
import type { ScoredResponse } from "@/types/scored-funds";

export type HomepageScoresRowSource = "scores" | "serving_core" | "none";

export type TrueUniverseTotalResolution =
  | { kind: "known"; value: number; source: string }
  | { kind: "unknown"; reason: string };

export type HomepageTotalsEvidence = {
  trueUniverse: TrueUniverseTotalResolution;
  loadedPreviewRowCount: number;
  scoresRowSource: HomepageScoresRowSource;
  scoresTimedOut: boolean;
  /** Sunucunun skor payload’unda gelen `total` (bilinçli olarak yalnızca güvenilir bağlamda kullanılır) */
  rawScoresTotal: number | null;
  marketSnapshotFundCount: number | null;
  marketSnapshotCanonical: boolean;
};

function isLikelyTruncatedUniverseTotal(
  total: number,
  rowCount: number,
  previewLimit: number
): boolean {
  if (rowCount <= 0 || total <= 0) return false;
  if (total !== rowCount) return false;
  return rowCount >= previewLimit;
}

/**
 * Keşif evreni için kanonik toplam: yalnızca güvenilir kaynaklardan üretilir.
 * `serving_core` önizlemesinin `total` alanı (satır sayısı) burada kullanılmaz.
 */
export function resolveHomepageTrueUniverseTotal(input: {
  initialScores: ScoredResponse | null;
  initialRowsSource: HomepageScoresRowSource;
  scoresTimedOut: boolean;
  scoresPreviewLimit: number;
  marketSnapshotFundCount: number | null;
  marketSnapshotCanonical: boolean;
}): TrueUniverseTotalResolution {
  if (input.initialRowsSource === "serving_core") {
    if (input.marketSnapshotFundCount != null && input.marketSnapshotFundCount > 0 && input.marketSnapshotCanonical) {
      return { kind: "known", value: input.marketSnapshotFundCount, source: "market_snapshot_while_serving_rows" };
    }
    return {
      kind: "unknown",
      reason: "serving_core_rows_without_canonical_market_snapshot",
    };
  }

  if (input.initialRowsSource === "none") {
    if (input.marketSnapshotFundCount != null && input.marketSnapshotFundCount > 0 && input.marketSnapshotCanonical) {
      return { kind: "known", value: input.marketSnapshotFundCount, source: "market_snapshot_only" };
    }
    return { kind: "unknown", reason: "no_scores_and_no_market" };
  }

  // scores path
  if (input.scoresTimedOut || !input.initialScores) {
    if (input.marketSnapshotFundCount != null && input.marketSnapshotFundCount > 0 && input.marketSnapshotCanonical) {
      return { kind: "known", value: input.marketSnapshotFundCount, source: "market_snapshot_after_scores_miss" };
    }
    return { kind: "unknown", reason: "scores_unavailable_or_timed_out" };
  }

  const total = readScoresUniverseTotal(input.initialScores);
  const rows = input.initialScores.funds.length;
  if (!Number.isFinite(total) || total <= 0) {
    if (input.marketSnapshotFundCount != null && input.marketSnapshotFundCount > 0 && input.marketSnapshotCanonical) {
      return { kind: "known", value: input.marketSnapshotFundCount, source: "market_snapshot_scores_total_invalid" };
    }
    return { kind: "unknown", reason: "scores_total_invalid" };
  }

  if (isLikelyTruncatedUniverseTotal(total, rows, input.scoresPreviewLimit)) {
    if (input.marketSnapshotFundCount != null && input.marketSnapshotFundCount > 0 && input.marketSnapshotCanonical) {
      return { kind: "known", value: input.marketSnapshotFundCount, source: "market_snapshot_ambiguous_scores_total" };
    }
    return { kind: "unknown", reason: "scores_total_equals_row_count_at_preview_cap" };
  }

  if (rows > 0 && total < rows) {
    if (input.marketSnapshotFundCount != null && input.marketSnapshotFundCount > 0 && input.marketSnapshotCanonical) {
      return { kind: "known", value: input.marketSnapshotFundCount, source: "market_snapshot_scores_total_lt_rows" };
    }
    return { kind: "unknown", reason: "scores_total_inconsistent_with_rows" };
  }

  return { kind: "known", value: total, source: "scores_db_snapshot" };
}

export function buildHomepageTotalsEvidence(input: {
  resolution: TrueUniverseTotalResolution;
  loadedPreviewRowCount: number;
  scoresRowSource: HomepageScoresRowSource;
  scoresTimedOut: boolean;
  rawScoresTotal: number | null;
  marketSnapshotFundCount: number | null;
  marketSnapshotCanonical: boolean;
}): HomepageTotalsEvidence {
  return {
    trueUniverse: input.resolution,
    loadedPreviewRowCount: input.loadedPreviewRowCount,
    scoresRowSource: input.scoresRowSource,
    scoresTimedOut: input.scoresTimedOut,
    rawScoresTotal: input.rawScoresTotal,
    marketSnapshotFundCount: input.marketSnapshotFundCount,
    marketSnapshotCanonical: input.marketSnapshotCanonical,
  };
}

export function formatHomepageTotalsEvidenceLog(ev: HomepageTotalsEvidence): string {
  const tu = ev.trueUniverse;
  const tuPart =
    tu.kind === "known" ? `true_universe=${tu.value} true_universe_source=${tu.source}` : `true_universe=unknown reason=${tu.reason}`;
  return (
    `[home-ssr-totals] ${tuPart} loaded_preview_rows=${ev.loadedPreviewRowCount} scores_source=${ev.scoresRowSource} ` +
    `scores_timed_out=${ev.scoresTimedOut ? 1 : 0} raw_scores_total=${ev.rawScoresTotal ?? "none"} ` +
    `market_fund_count=${ev.marketSnapshotFundCount ?? "none"} market_canonical=${ev.marketSnapshotCanonical ? 1 : 0}`
  );
}

/**
 * Merkezi yüzey sözleşmeleri: UI katmanı ham kaynak / fallback semantiği çıkarmamalı.
 * Bu dosya tipleri taşır; iş kuralları ilgili modüllerde kalır (ör. homepage-fund-counts).
 */

import type { HomepageTotalsEvidence } from "@/lib/homepage-fund-counts";

/**
 * A. Homepage totals — `HomepageTotalsEvidence` üstüne anlamsal alanlar (evren ≠ önizleme limiti).
 * `trueUniverse` / `loadedPreviewRowCount` evidence içinde zaten ayrı; burada yalnızca `previewLimit` eklenir.
 */
export type HomepageTotalsSemanticContract = HomepageTotalsEvidence & {
  /** Önizleme üst sınırı (örn. 180); asla kanonik evren toplamı sayılmaz. */
  previewLimit: number;
};

/** B. Keşif yüzeyi — tek enum; UI buna göre metin/telemetri seçebilir. */
export type HomepageDiscoverySurfaceState =
  | { kind: "ready" }
  | { kind: "degraded_invalid_payload"; reason: string }
  | { kind: "degraded_missing_categories" }
  | {
      kind: "degraded_empty_result";
      reason:
        | "no_scores_payload_after_boundary"
        | "empty_scores_row_list"
        | "normalization_removed_all_rows";
    };

/** C. Detay (ileri kablolama için tek tip; orchestrator rollup ile hizalanacak). */
export type DetailSurfaceState =
  | { kind: "ready" }
  | { kind: "degraded_db_unavailable" }
  | { kind: "degraded_invalid_payload"; reason: string }
  | { kind: "degraded_insufficient_data" }
  | { kind: "degraded_no_comparison_section" }
  | { kind: "degraded_insufficient_rows" };

/** D. Kıyas (route + istemci için ortak sözlük). */
export type CompareSurfaceState =
  | { kind: "ready" }
  | { kind: "degraded_insufficient_funds" }
  | { kind: "degraded_db_unavailable" }
  | { kind: "degraded_timeout" }
  | { kind: "degraded_invalid_payload"; reason: string };

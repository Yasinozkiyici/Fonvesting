/**
 * Karşılaştırma özeti (FundDetailChart) — smoke ve sözleşme için tek kaynak.
 * `innerText` / erişilebilir metin her durumda aynı alt diziyi içermeli (prodlike UI smoke).
 */
export const FUND_DETAIL_COMPARISON_SUMMARY_SMOKE_SUBSTRING = "öncelikli net fark";

export type FundDetailComparisonSummaryPanelState =
  | "ready"
  | "degraded_no_comparison_section"
  | "degraded_insufficient_rows";

export function resolveFundDetailComparisonSummaryPanelState(input: {
  shouldRenderComparisonSection: boolean;
  comparisonRowCount: number;
}): FundDetailComparisonSummaryPanelState {
  if (!input.shouldRenderComparisonSection) return "degraded_no_comparison_section";
  if (input.comparisonRowCount === 0) return "degraded_insufficient_rows";
  return "ready";
}

/** Sunucu sözleşmesi dışı — kıyas bloğu yok / geçersiz; görünür başlık + açıklama. */
export const COMPARISON_SUMMARY_DEGRADED_NO_SECTION_LEAD =
  "Öncelikli net fark özeti şu an üretilemedi. Sunucu tarafında referans penceresi kurulamadı veya veri kaynağı geçici olarak kullanılamıyor.";

/** Bölüm açık ama seçili pencerede satır üretilemedi. */
export const COMPARISON_SUMMARY_INSUFFICIENT_ROWS_LEAD =
  "Öncelikli net fark bu dönem için hesaplanamıyor; seçili dönem için karşılaştırma verisi henüz yeterli değil.";

export function comparisonSummaryCopyIncludesSmokeToken(copy: string, locale = "tr-TR"): boolean {
  return copy.trim().toLocaleLowerCase(locale).includes(FUND_DETAIL_COMPARISON_SUMMARY_SMOKE_SUBSTRING);
}

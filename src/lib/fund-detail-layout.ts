/**
 * Fon detay sayfası — bilgi hiyerarşisi ve Phase 2 uzantı noktaları.
 * Görünür metin eklemez; yalnızca yapı ve derin bağlantı sabitleri.
 *
 * Sıra (page): özet → aksiyonlar → performans / kıyas → risk → trendler → alternatifler → profil.
 *
 * @see FUTURE_PRODUCT_SECTIONS in `@/config/future-product-sections`
 */
export const FUND_DETAIL_PHASE2_IDS = {
  /** Yan yana / gömülü karşılaştırma */
  comparison: "fund-detail-comparison",
  /** Aynı kategoride seçilmiş alternatifler (FundDetailSimilar) */
  alternatives: "fund-detail-alternatives",
} as const;

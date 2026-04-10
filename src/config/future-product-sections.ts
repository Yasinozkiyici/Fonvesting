/**
 * Phase 2+ uzantı noktaları — ayrılmış rotalar ve modül adları.
 * Phase 1: `/compare` rotası rehber sayfası olarak kalır; ana nav’da Karşılaştır yok.
 *
 * Planlanan yüzeyler (Phase 1’de yok):
 * - Neden öne çıkıyor: farklılaşan anlatı / kanıt noktaları
 * - Karşılaştırma görünümü: yan yana fon kıyası
 * - Alternatifler: benzer fon ve ikame keşfi
 * - Portföy stüdyosu: dağılım ve senaryo araçları
 *
 * Fon detay sayfası DOM id’leri: `@/lib/fund-detail-layout` → FUND_DETAIL_PHASE2_IDS
 */
export const FUTURE_PRODUCT_SECTIONS = {
  whyItStandsOut: { route: "/why-yatirim", label: "Neden Yatirim.io" },
  comparisonView: { route: "/compare", label: "Karşılaştır" },
  alternatives: { route: "/alternatives", label: "Alternatifler" },
  portfolioStudio: { route: "/portfolio-studio", label: "Portföy stüdyosu" },
} as const;

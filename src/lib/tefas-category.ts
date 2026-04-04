/**
 * TEFAS fon adından kategori kodu çıkarımı (Türkçe büyük harf).
 * Daha spesifik ifadeler üstte olmalı.
 */
const NAME_RULES: ReadonlyArray<{ needles: string[]; code: string }> = [
  { needles: ["HİSSE SENEDİ", "HISSE SENEDI", "HISSE SENEDİ"], code: "HSF" },
  { needles: ["PARA PİYASASI", "PARA PIYASASI"], code: "PPF" },
  { needles: ["ALTIN", "KIYMETLİ MADEN", "KIYMETLI MADEN"], code: "ALT" },
  { needles: ["BORÇLANMA", "BORCLANMA", "TAHVİL", "TAHVIL", "BONO"], code: "BRC" },
  { needles: ["KATILIM"], code: "KTL" },
  { needles: ["SERBEST"], code: "SRB" },
  { needles: ["FON SEPETİ", "FON SEPETI", "FON SEPET"], code: "FSP" },
  { needles: ["DEĞİŞKEN", "DEGISKEN"], code: "DGS" },
  { needles: ["KARMA"], code: "KRM" },
  { needles: ["GAYRİMENKUL", "GAYRIMENKUL", "GAYRİ MENKUL"], code: "DGR" },
  { needles: ["DÖVİZ", "DOVIZ", "KUR KORUMA", "KUR KORU"], code: "DGR" },
  { needles: ["EMTİA", "EMTIA"], code: "DGR" },
];

export const TEFAS_CATEGORY_SEED: ReadonlyArray<{
  code: string;
  name: string;
  color: string | null;
  description: string | null;
}> = [
  { code: "PPF", name: "Para Piyasası Fonu", color: "#3B82F6", description: null },
  { code: "HSF", name: "Hisse Senedi Fonu", color: "#10B981", description: null },
  { code: "ALT", name: "Altın / Emtia Fonu", color: "#F59E0B", description: null },
  { code: "BRC", name: "Borçlanma Araçları Fonu", color: "#8B5CF6", description: null },
  { code: "KTL", name: "Katılım Fonu", color: "#06B6D4", description: null },
  { code: "SRB", name: "Serbest Fon", color: "#6366F1", description: null },
  { code: "FSP", name: "Fon Sepeti Fonu", color: "#EC4899", description: null },
  { code: "DGS", name: "Değişken Fon", color: "#14B8A6", description: null },
  { code: "KRM", name: "Karma Fon", color: "#84CC16", description: null },
  { code: "DGR", name: "Diğer", color: "#64748B", description: null },
];

export function inferTefasCategoryCode(fundName: string): string | null {
  const u = fundName.toLocaleUpperCase("tr-TR");
  for (const { needles, code } of NAME_RULES) {
    for (const n of needles) {
      if (u.includes(n.toLocaleUpperCase("tr-TR"))) return code;
    }
  }
  return null;
}

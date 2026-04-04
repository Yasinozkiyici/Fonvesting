/**
 * Phase 2 — canonical fund URLs (detay, karşılaştırma).
 * Ana tablo ve kartlar bu yardımcıyı kullanır; rota genişledikçe tek noktadan güncellenir.
 */
export function fundDetailHref(code: string): string {
  return `/fund/${encodeURIComponent(code.trim())}`;
}

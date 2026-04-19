import { readScoresMatchedTotal } from "@/lib/scores-response-counts";
import type { ScoredResponse } from "@/types/scored-funds";

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

/**
 * Faz 4: discovery aktif olsa da tabloyu `null` ile başlatma.
 * SSR/önceki anlamlı payload korunur; refresh sırasında "loading_refresh" gösterilebilir.
 */
export function resolveHomepageTableSeedPayload(input: {
  initialScoresPreview: ScoredResponse | null;
}): ScoredResponse | null {
  return input.initialScoresPreview;
}


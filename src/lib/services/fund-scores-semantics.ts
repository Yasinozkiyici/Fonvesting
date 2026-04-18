import type { RankingMode } from "@/lib/scoring";
import type { ScoredFundRow, ScoresApiPayload } from "@/lib/services/fund-scores-types";

/**
 * Skor yanıtı için tek üretim noktası: `total` her zaman `universeTotal` ile aynı (geriye dönük).
 * Tema / arama sonrası eşleşen sayı `matchedTotal`; gövdedeki satır sayısı `returnedCount`.
 */
export function createScoresPayload(input: {
  mode: RankingMode;
  funds: ScoredFundRow[];
  universeTotal: number;
  matchedTotal: number;
  appliedQuery?: string;
}): ScoresApiPayload {
  const returnedCount = input.funds.length;
  const universeTotal = Number.isFinite(input.universeTotal) ? Math.max(0, Math.trunc(input.universeTotal)) : 0;
  const matchedTotal = Number.isFinite(input.matchedTotal)
    ? Math.max(0, Math.trunc(input.matchedTotal))
    : returnedCount;
  return {
    mode: input.mode,
    funds: input.funds,
    universeTotal,
    matchedTotal: Math.max(matchedTotal, returnedCount),
    returnedCount,
    total: universeTotal,
    ...(input.appliedQuery !== undefined && String(input.appliedQuery).trim()
      ? { appliedQuery: String(input.appliedQuery).trim() }
      : {}),
  };
}

/** Yanıt satır limiti uygula; evren / eşleşme sayıları değişmez, yalnızca `returnedCount`. */
export function applyScoresPayloadRowLimit(payload: ScoresApiPayload, limit: number | null): ScoresApiPayload {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return payload;
  const cap = Math.min(Math.trunc(limit), payload.funds.length);
  return createScoresPayload({
    mode: payload.mode,
    funds: payload.funds.slice(0, cap),
    universeTotal: payload.universeTotal,
    matchedTotal: payload.matchedTotal,
    appliedQuery: payload.appliedQuery,
  });
}

/** Bellekteki eski önbellek girdileri için: yeni alanlar yoksa `total` üzerinden türet. */
export function coerceScoresPayloadFromLegacy(p: ScoresApiPayload): ScoresApiPayload {
  if (
    typeof p.universeTotal === "number" &&
    Number.isFinite(p.universeTotal) &&
    typeof p.matchedTotal === "number" &&
    Number.isFinite(p.matchedTotal) &&
    typeof p.returnedCount === "number" &&
    Number.isFinite(p.returnedCount)
  ) {
    return {
      ...p,
      total: p.universeTotal,
    };
  }
  const returned = p.funds.length;
  const legacy = typeof p.total === "number" && Number.isFinite(p.total) ? p.total : returned;
  return createScoresPayload({
    mode: p.mode,
    funds: p.funds,
    universeTotal: legacy,
    matchedTotal: Math.max(legacy, returned),
    appliedQuery: p.appliedQuery,
  });
}

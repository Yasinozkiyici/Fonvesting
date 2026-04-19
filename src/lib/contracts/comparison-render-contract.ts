import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

const MIN_COMPARISON_VALID_REFS = 1;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Sunucu kıyas bloğundaki referans başına geçerli satır sayımı — tek doğruluk kaynağı. */
export function countComparisonReferenceRows(data: FundDetailPageData): { valid: number; total: number } {
  const rowsByRef = data.kiyasBlock?.rowsByRef;
  if (!rowsByRef) return { valid: 0, total: 0 };
  let valid = 0;
  let total = 0;
  for (const rows of Object.values(rowsByRef)) {
    if (!rows?.length) continue;
    total += 1;
    if (rows.some((item) => isFiniteNumber(item.fundPct) && isFiniteNumber(item.refPct))) {
      valid += 1;
    }
  }
  return { valid, total };
}

export type ComparisonRenderReason =
  | "comparison_ready"
  | "no_kiyas_block"
  | "insufficient_valid_refs"
  | "optional_kiyas_degraded";

/**
 * Fon detayı getiri karşılaştırması: tek kanonik render sözleşmesi (sunucu kıyas bloğu).
 * İstemci compare-series zenginleştirmesi ayrı çözülür; bu nesne sunucu gerçeğini taşır.
 */
export type ComparisonRenderContract = {
  renderable: boolean;
  validRefs: number;
  attemptedRefs: number;
  reason: ComparisonRenderReason;
  degraded: boolean;
  /** Faz 5’te doldurulacak; şimdilik null */
  freshness: null;
};

export function deriveComparisonRenderContract(data: FundDetailPageData): ComparisonRenderContract {
  const { valid, total } = countComparisonReferenceRows(data);
  const attemptedFromRefs = data.kiyasBlock?.refs?.length ?? 0;
  const attemptedRefs = attemptedFromRefs > 0 ? attemptedFromRefs : total;
  const degraded =
    data.detailHealth?.compareHealth === "degraded" ||
    Boolean(
      data.degraded?.reasons?.some(
        (r) => r.includes("kiyas") || r.includes("Kiyas") || r.includes("optional_kiyas")
      )
    );

  if (!data.kiyasBlock) {
    return {
      renderable: false,
      validRefs: 0,
      attemptedRefs: 0,
      reason: "no_kiyas_block",
      degraded,
      freshness: null,
    };
  }
  if (valid < MIN_COMPARISON_VALID_REFS) {
    return {
      renderable: false,
      validRefs: valid,
      attemptedRefs,
      reason: degraded ? "optional_kiyas_degraded" : "insufficient_valid_refs",
      degraded,
      freshness: null,
    };
  }
  return {
    renderable: true,
    validRefs: valid,
    attemptedRefs,
    reason: "comparison_ready",
    degraded,
    freshness: null,
  };
}

/**
 * Grafik/özet birleşik görünürlük: sunucu sözleşmesi + istemci penceresi birleşimi tek yerde.
 */
export function resolveFundDetailComparisonShouldRender(
  contract: ComparisonRenderContract,
  hasAugmentedRenderablePayload: boolean
): boolean {
  return contract.renderable || hasAugmentedRenderablePayload;
}

import type { ScoresApiPayload } from "@/lib/services/fund-scores-types";

/**
 * TEFAS fon türü kodu — Fund.fundTypeId ile eşleşen kayıt; kategori (Hisse, Para Piyasası vb.) değil.
 * Kod 0/1 dışı gelecek olursa DB adı kısaltılarak gösterilir.
 */
const TEFAS_FUND_TYPE_LABELS: Record<number, string> = {
  0: "Yatırım Fonları",
  1: "Emeklilik Fonları",
};

/** Parantez içi BES vb. sonekleri kaldırır (eski DB / önbellek metinleri için). */
export function shortenFundTypeName(name: string): string {
  let s = name.trim();
  if (!s) return "—";
  s = s.replace(/\s*\(\s*BES\s*\)\s*$/i, "").trim();
  s = s.replace(/\s*\(\s*bes\s*\)\s*$/i, "").trim();
  return s || "—";
}

/** Tablo, chip ve API için kısa, tutarlı fon türü metni. */
export function fundTypeDisplayLabel(fundType: { code: number; name: string } | null | undefined): string {
  if (!fundType) return "—";
  const byCode = TEFAS_FUND_TYPE_LABELS[fundType.code];
  if (byCode) return byCode;
  return shortenFundTypeName(fundType.name);
}

export function fundTypeForApi(ft: { code: number; name: string } | null): { code: number; name: string } | null {
  if (!ft) return null;
  return { code: ft.code, name: fundTypeDisplayLabel(ft) };
}

/** Sıralama: görünen etiket (Türkçe yerel kuralları). */
export function fundTypeSortKey(fundType: { code: number; name: string } | null | undefined): string {
  return fundTypeDisplayLabel(fundType).toLocaleLowerCase("tr");
}

/** Önbellekteki eski uzun isimleri okurken düzeltir. */
export function normalizeScoresPayloadFundTypes(payload: ScoresApiPayload): ScoresApiPayload {
  return {
    mode: payload.mode,
    total: payload.universeTotal ?? payload.total,
    universeTotal: payload.universeTotal ?? payload.total,
    matchedTotal: payload.matchedTotal ?? payload.total,
    returnedCount: payload.returnedCount ?? payload.funds.length,
    ...(payload.appliedQuery ? { appliedQuery: payload.appliedQuery } : {}),
    funds: payload.funds.map((f) => ({
      fundId: f.fundId,
      code: f.code,
      name: f.name,
      shortName: f.shortName,
      logoUrl: f.logoUrl,
      lastPrice: f.lastPrice,
      dailyReturn: f.dailyReturn,
      portfolioSize: f.portfolioSize,
      investorCount: f.investorCount,
      finalScore: f.finalScore,
      category: f.category,
      fundType: f.fundType ? { code: f.fundType.code, name: fundTypeDisplayLabel(f.fundType) } : null,
    })),
  };
}

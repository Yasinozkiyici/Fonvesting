/**
 * Fon türü chip’i için düşük doygunluklu ton sınıfı.
 * `displayLabel` — fundTypeDisplayLabel() çıktısı (TEFAS kodu ile uyumlu kısa metin).
 */
export function fundTypeChipToneClass(
  fundType: { code: number; name: string } | null,
  displayLabel: string
): string {
  const dl = displayLabel.trim();
  if (!dl || dl === "—") return "fund-type-chip--tone-neutral";

  const n = dl.toLocaleLowerCase("tr");

  if (fundType?.code === 1 || /\b(bes|emeklilik)\b/i.test(dl)) {
    return "fund-type-chip--tone-bes";
  }

  if (/katılım/i.test(n)) return "fund-type-chip--tone-participation";
  if (/para\s*piyasas|likidite|kısa\s*vadeli/i.test(n)) return "fund-type-chip--tone-liquidity";
  if (/\bhisse\b|pay\s*senedi/i.test(n)) return "fund-type-chip--tone-equity";
  if (/borçlanma|tahvil|sermaye\s*korumalı/i.test(n)) return "fund-type-chip--tone-bond";
  if (/altın|emtia|maden/i.test(n)) return "fund-type-chip--tone-commodity";

  if (fundType?.code === 0 || /yatırım/i.test(n)) {
    return "fund-type-chip--tone-yat";
  }

  return "fund-type-chip--tone-neutral";
}

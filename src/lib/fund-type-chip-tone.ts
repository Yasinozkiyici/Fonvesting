/**
 * Fon türü chip’i için düşük doygunluklu ton sınıfı (TEFAS kodu + isim anahtar kelimeleri).
 */
export function fundTypeChipToneClass(
  fundType: { code: number; name: string } | null,
  label: string
): string {
  const raw = (fundType?.name ?? label).trim();
  if (!raw || raw === "—") return "fund-type-chip--tone-neutral";

  const n = raw.toLocaleLowerCase("tr");

  if (fundType?.code === 1 || /\b(bes|emeklilik)\b/i.test(raw)) {
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

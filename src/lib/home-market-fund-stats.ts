/**
 * Ana sayfa üst metrik şeridi ile fon tablosu sayıları farklı kaynaklardan gelebilir:
 * - `snapshotFundCount`: piyasa özeti (MarketSnapshot.totalFundCount veya aktif fon sayımı)
 * - `exploreUniverseTotal`: /api/funds/scores ile aynı `total` — tabloda sıralanan keşif evreni
 *
 * İkisi aynı değilse aynı etiketle göstermek güven sorunu yaratır; bu yardımcı açık ayrım üretir.
 */
export type HomeMarketFundCell = {
  primaryLabel: string;
  primaryValue: string;
  /** İkinci sayı veya açıklama; yoksa tek satır yeterli */
  secondaryLine: string | null;
  /** aria-describedby / title için */
  fullDescription: string;
};

function fmtTrInt(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  return Math.round(n).toLocaleString("tr-TR");
}

export function describeHomeMarketFundCell(input: {
  snapshotFundCount: number;
  exploreUniverseTotal: number | null | undefined;
}): HomeMarketFundCell {
  const snap = input.snapshotFundCount;
  const exp = input.exploreUniverseTotal;

  if (exp != null && Number.isFinite(exp) && exp !== snap) {
    return {
      primaryLabel: "Keşif listesi",
      primaryValue: fmtTrInt(exp),
      secondaryLine: `${fmtTrInt(snap)} portföy kaydı`,
      fullDescription: `Tabloda sıralanan keşif evreni ${fmtTrInt(exp)} fon. Piyasa özetinde sayılan toplam kayıt ${fmtTrInt(snap)} fon (tamamı listede olmayabilir).`,
    };
  }

  return {
    primaryLabel: "Fon sayısı",
    primaryValue: fmtTrInt(snap),
    secondaryLine: null,
    fullDescription: `Piyasa özetinde sayılan fon adedi: ${fmtTrInt(snap)}.`,
  };
}

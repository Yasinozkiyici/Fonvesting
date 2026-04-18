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
  /** When false, `snapshotFundCount` is not a canonical universe total (subset / önizleme kabuğu). */
  snapshotFundCountIsCanonicalUniverse?: boolean;
}): HomeMarketFundCell {
  const snap = input.snapshotFundCount;
  const exp = input.exploreUniverseTotal;
  const snapCanon = input.snapshotFundCountIsCanonicalUniverse !== false;

  if (!snapCanon) {
    if (exp != null && Number.isFinite(exp)) {
      return {
        primaryLabel: "Keşif evreni",
        primaryValue: fmtTrInt(exp),
        secondaryLine: "Portföy özeti (sınırlı)",
        fullDescription:
          `Keşif tablosu için kanonik evren toplamı ${fmtTrInt(exp)} fon. Üst şeritteki portföy/fon sayımı şu an tam evreni temsil etmiyor (önizleme veya alt küme kabuğu).`,
      };
    }
    return {
      primaryLabel: "Fon sayısı",
      primaryValue: "—",
      secondaryLine: "Tam evren bilinmiyor",
      fullDescription:
        "Piyasa özeti şu an tam fon evreni sayısını güvenle göstermiyor; keşif evreni de henüz çözülemedi. Veri yenilendiğinde güncellenir.",
    };
  }

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

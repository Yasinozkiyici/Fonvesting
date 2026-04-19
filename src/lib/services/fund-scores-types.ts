import type { RankingMode } from "@/lib/scoring";
import type { FundThemeId } from "@/lib/fund-themes";

/** /api/funds/scores satırı: tablo ve sıralama için gereken hafif payload */
export type ScoredFundRow = {
  fundId: string;
  code: string;
  /** Günlük özet / türev metrik yoksa null (satır yine listelenir). */
  finalScore: number | null;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  lastPrice: number;
  dailyReturn: number;
  portfolioSize: number;
  investorCount: number;
  category: { code: string; name: string } | null;
  fundType: { code: number; name: string } | null;
  /** Kanonik keşif temaları (serving/DB); yoksa legacy isim eşlemesi devreye girer. */
  themeTags?: FundThemeId[];
};

export type ScoresApiPayload = {
  mode: RankingMode;
  /**
   * Tam keşif evreni (mode + kategori + sunucu kaynağının döndürdüğü kapsam; tema / istemci metin filtresi öncesi).
   * @deprecated Yeni kod `universeTotal` kullanmalı; bu alan her zaman `universeTotal` ile aynı tutulur.
   */
  total: number;
  universeTotal: number;
  /** Arama (q) + tema ile eşleşen fon sayısı (satır limiti uygulanmadan önce). */
  matchedTotal: number;
  /** Yanıt gövdesinde dönen satır sayısı (= funds.length). */
  returnedCount: number;
  funds: ScoredFundRow[];
  /** İstemci: sunucu metin filtresi uyguladıysa çift filtreleme yapmamak için */
  appliedQuery?: string;
};

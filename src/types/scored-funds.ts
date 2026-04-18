import type { RankingMode } from "@/lib/scoring";

export interface ScoredFund {
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  lastPrice: number;
  dailyReturn: number;
  portfolioSize: number;
  investorCount: number;
  category: { code: string; name: string } | null;
  fundType: { code: number; name: string } | null;
  finalScore: number | null;
}

export interface ScoredResponse {
  mode: RankingMode;
  /**
   * Tam keşif evreni toplamı (`universeTotal` ile aynı; geriye dönük alan).
   * @deprecated Doğrudan `universeTotal` tercih edilir.
   */
  total: number;
  /** Tam keşif evreni (tema / istemci araması öncesi, sunucu kapsamı). */
  universeTotal?: number;
  /** Sunucu tema + sunucu q ile eşleşen fon sayısı. */
  matchedTotal?: number;
  /** Sunucunun döndürdüğü satır sayısı. */
  returnedCount?: number;
  funds: ScoredFund[];
  /** Sunucu metin filtresi uygulandıysa (q/query) */
  appliedQuery?: string;
}

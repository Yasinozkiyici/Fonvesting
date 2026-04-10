import type { RankingMode } from "@/lib/scoring";

/** /api/funds/scores satırı: tablo ve sıralama için gereken hafif payload */
export type ScoredFundRow = {
  fundId: string;
  code: string;
  finalScore: number;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  lastPrice: number;
  dailyReturn: number;
  portfolioSize: number;
  investorCount: number;
  category: { code: string; name: string } | null;
  fundType: { code: number; name: string } | null;
};

export type ScoresApiPayload = {
  mode: RankingMode;
  total: number;
  funds: ScoredFundRow[];
  /** İstemci: sunucu metin filtresi uyguladıysa çift filtreleme yapmamak için */
  appliedQuery?: string;
};

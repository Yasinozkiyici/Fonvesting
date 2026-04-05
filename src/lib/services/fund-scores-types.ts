import type { FundScore, RankingMode } from "@/lib/scoring";

/** /api/funds/scores satırı: skor + tablo alanları */
export type ScoredFundRow = FundScore & {
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
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

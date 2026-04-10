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
  finalScore: number;
}

export interface ScoredResponse {
  mode: RankingMode;
  total: number;
  funds: ScoredFund[];
  /** Sunucu metin filtresi uygulandıysa (q/query) */
  appliedQuery?: string;
}

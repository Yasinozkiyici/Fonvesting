import type { RankingMode } from "@/lib/scoring";
import type { FundThemeId } from "@/lib/fund-themes";

/**
 * Tek doğruluk: keşif isteğinin sunucu tarafı kapsamı.
 * Tüm discovery yüzeyleri bu şekli kullanır; paralel türetilmiş scope anahtarları kabul edilmez.
 */
export type DiscoveryScopeInput = {
  mode: RankingMode;
  categoryCode: string;
  theme: FundThemeId | null;
  queryTrim: string;
  limit: number | null;
};

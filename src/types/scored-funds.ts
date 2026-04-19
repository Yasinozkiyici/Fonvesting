import type { DiscoveryPayloadContract } from "@/lib/contracts/discovery-payload-contract";
import type { CanonicalFreshnessContract } from "@/lib/freshness-contract";
import type { RankingMode } from "@/lib/scoring";
import type { ScoresApiSurfaceState } from "@/app/api/funds/scores/contract";
import type { FundThemeId } from "@/lib/fund-themes";

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
  themeTags?: FundThemeId[];
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
  /** meta.discovery — varsa toplamlar yalnızca buradan yorumlanmalıdır. */
  discoveryContract?: DiscoveryPayloadContract | null;
  /** meta.surfaceState */
  scoresSurfaceState?: ScoresApiSurfaceState | null;
  /** meta.canonicalFreshness veya istemci türetimi */
  canonicalFreshness?: CanonicalFreshnessContract | null;
}

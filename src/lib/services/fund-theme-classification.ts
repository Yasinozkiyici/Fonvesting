import type { ScoredFund } from "@/types/scored-funds";
import type { ScoredFundRow } from "@/lib/services/fund-scores-types";
import { FUND_THEMES, fundMatchesTheme, type FundThemeId } from "@/lib/fund-themes";

/** DB `FundThemeTag.source` ve serving meta ile uyumlu sabit. */
export const THEME_CLASSIFICATION_SOURCE = "inferred_v1" as const;

/**
 * Deterministik tema kümesi: mevcut token kurallarıyla (fundMatchesTheme) aynı sonucu üretir,
 * ancak yalnızca rebuild/backfill sırasında çalıştırılır — runtime keşif buradan okur.
 */
export function inferThemeTagsFromFundFields(name: string, shortName: string | null): FundThemeId[] {
  const stub = {
    fundId: "",
    code: "",
    name,
    shortName,
    logoUrl: null,
    lastPrice: 0,
    dailyReturn: 0,
    portfolioSize: 0,
    investorCount: 0,
    category: null,
    fundType: null,
    finalScore: null,
  } satisfies ScoredFund;
  const tags: FundThemeId[] = [];
  for (const def of FUND_THEMES) {
    if (fundMatchesTheme(stub, def.id)) tags.push(def.id);
  }
  return tags;
}

/**
 * Kanonik keşif: themeTags doluysa yalnızca etiket dizisi; aksi halde geçici geriye dönük (legacy) isim eşlemesi.
 */
export function fundRowMatchesCanonicalTheme(
  fund: Pick<ScoredFundRow, "themeTags" | "name" | "shortName">,
  theme: FundThemeId
): boolean {
  if (fund.themeTags && fund.themeTags.length > 0) {
    return fund.themeTags.includes(theme);
  }
  return fundMatchesTheme(fund as ScoredFund, theme);
}

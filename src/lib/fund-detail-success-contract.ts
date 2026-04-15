export type FundDetailSuccessContractPayload = {
  fund: {
    category: { code: string; name: string } | null;
  };
  similarFunds: Array<unknown>;
  similarCategoryPeerDailyReturns: Array<number>;
  categoryReturnAverages: unknown | null;
  kiyasBlock: unknown | null;
};

function hasCategoryContext(payload: FundDetailSuccessContractPayload): boolean {
  const code = payload.fund.category?.code?.trim();
  return Boolean(code);
}

export function hasOptionalEnrichment(payload: FundDetailSuccessContractPayload): boolean {
  return (
    payload.similarFunds.length > 0 ||
    payload.similarCategoryPeerDailyReturns.length > 0 ||
    payload.categoryReturnAverages != null ||
    payload.kiyasBlock != null
  );
}

export function requiresAlternativesRepair(payload: FundDetailSuccessContractPayload): boolean {
  return hasCategoryContext(payload) && payload.similarFunds.length === 0;
}

export function needsPhase2OptionalRefresh(payload: FundDetailSuccessContractPayload): boolean {
  if (payload.kiyasBlock == null) return true;
  return requiresAlternativesRepair(payload);
}

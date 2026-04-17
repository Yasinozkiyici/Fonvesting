export type FundDetailSuccessContractPayload = {
  fund: {
    category: { code: string; name: string } | null;
  };
  similarFunds: Array<unknown>;
  similarCategoryPeerDailyReturns: Array<number>;
  categoryReturnAverages: unknown | null;
  kiyasBlock: unknown | null;
};

function hasMeaningfulComparison(payload: FundDetailSuccessContractPayload): boolean {
  const block = payload.kiyasBlock;
  if (!block || typeof block !== "object") return false;
  const candidate = block as {
    refs?: unknown;
    rowsByRef?: Record<string, Array<{ periodId?: unknown; fundPct?: unknown; refPct?: unknown }>>;
  };
  if (!Array.isArray(candidate.refs) || candidate.refs.length === 0) return false;
  if (!candidate.rowsByRef || typeof candidate.rowsByRef !== "object") return false;
  for (const rows of Object.values(candidate.rowsByRef)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row?.periodId !== "1y") continue;
      const fundPct = typeof row.fundPct === "number" ? row.fundPct : Number.NaN;
      const refPct = typeof row.refPct === "number" ? row.refPct : Number.NaN;
      if (Number.isFinite(fundPct) && Number.isFinite(refPct)) return true;
    }
  }
  return false;
}

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
  if (!hasMeaningfulComparison(payload)) return true;
  return requiresAlternativesRepair(payload);
}

import type { CompareSurfaceState } from "@/lib/data-flow/contracts";

export type CompareBoundaryFundRow = {
  code: string;
  name: string;
  shortName: string | null;
  logoUrl?: string | null;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  category: { code: string; name: string } | null;
  fundType: { code: number; name: string } | null;
  volatility1y: number | null;
  maxDrawdown1y: number | null;
  variabilityLabel: "Sakin" | "Orta" | "Geniş" | null;
};

export type CompareBoundaryContext = {
  anchorDate: string;
  refs: { key: string; label: string }[];
  defaultRef: string;
  periods: { id: string; label: string }[];
  summaryByRef: Record<string, string>;
  matrix: Record<string, Record<string, Array<{ periodId: string; fundPct: number | null; refPct: number | null; band: string | null; diffPct: number | null }>>>;
};

export type CompareBoundaryResult = {
  surfaceState: CompareSurfaceState;
  funds: CompareBoundaryFundRow[];
  compare: CompareBoundaryContext | null;
  diagnostics: {
    requestedCount: number;
    returnedCount: number;
    rejectedRows: number;
    degradedSource: string | null;
    failureClass: string | null;
  };
};

function normalizeFundRow(row: unknown): CompareBoundaryFundRow | null {
  if (!row || typeof row !== "object") return null;
  const item = row as Record<string, unknown>;
  const code = typeof item.code === "string" ? item.code.trim().toUpperCase() : "";
  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (!code || !name) return null;
  return {
    code,
    name,
    shortName: typeof item.shortName === "string" ? item.shortName : null,
    logoUrl: typeof item.logoUrl === "string" ? item.logoUrl : null,
    lastPrice: typeof item.lastPrice === "number" && Number.isFinite(item.lastPrice) ? item.lastPrice : 0,
    dailyReturn: typeof item.dailyReturn === "number" && Number.isFinite(item.dailyReturn) ? item.dailyReturn : 0,
    monthlyReturn: typeof item.monthlyReturn === "number" && Number.isFinite(item.monthlyReturn) ? item.monthlyReturn : 0,
    yearlyReturn: typeof item.yearlyReturn === "number" && Number.isFinite(item.yearlyReturn) ? item.yearlyReturn : 0,
    portfolioSize: typeof item.portfolioSize === "number" && Number.isFinite(item.portfolioSize) ? item.portfolioSize : 0,
    investorCount: typeof item.investorCount === "number" && Number.isFinite(item.investorCount) ? item.investorCount : 0,
    category:
      item.category && typeof item.category === "object" && typeof (item.category as { code?: unknown }).code === "string"
        ? {
            code: String((item.category as { code: unknown }).code),
            name: String((item.category as { name?: unknown }).name ?? ""),
          }
        : null,
    fundType:
      item.fundType && typeof item.fundType === "object" && typeof (item.fundType as { code?: unknown }).code === "number"
        ? {
            code: (item.fundType as { code: number }).code,
            name: String((item.fundType as { name?: unknown }).name ?? ""),
          }
        : null,
    volatility1y: typeof item.volatility1y === "number" && Number.isFinite(item.volatility1y) ? item.volatility1y : null,
    maxDrawdown1y:
      typeof item.maxDrawdown1y === "number" && Number.isFinite(item.maxDrawdown1y) ? item.maxDrawdown1y : null,
    variabilityLabel:
      item.variabilityLabel === "Sakin" || item.variabilityLabel === "Orta" || item.variabilityLabel === "Geniş"
        ? item.variabilityLabel
        : null,
  };
}

export function resolveCompareSurfaceState(input: {
  requestedCount: number;
  returnedCount: number;
  failureClass: string | null;
  degradedSource: string | null;
  payloadInvalid: boolean;
}): CompareSurfaceState {
  if (input.requestedCount < 2) return { kind: "degraded_insufficient_funds" };
  if (input.failureClass === "timeout") return { kind: "degraded_timeout" };
  if (input.failureClass === "db_unavailable") return { kind: "degraded_db_unavailable" };
  if (input.payloadInvalid) return { kind: "degraded_invalid_payload", reason: "compare_payload_invalid" };
  if (input.returnedCount < 2) return { kind: "degraded_insufficient_funds" };
  if (input.degradedSource && input.degradedSource !== "serving_compare_inputs") {
    return { kind: "degraded_invalid_payload", reason: `compare_degraded_source_${input.degradedSource}` };
  }
  return { kind: "ready" };
}

export function normalizeCompareApiBoundary(input: {
  body: unknown;
  requestedCodes: string[];
  fallbackFailureClass?: string | null;
}): CompareBoundaryResult {
  const source = input.body && typeof input.body === "object" ? (input.body as Record<string, unknown>) : {};
  const rowsRaw = Array.isArray(source.funds) ? source.funds : [];
  const rows = rowsRaw.map(normalizeFundRow).filter((row): row is CompareBoundaryFundRow => row != null);
  const compare = source.compare && typeof source.compare === "object" ? (source.compare as CompareBoundaryContext) : null;
  const meta = source.meta && typeof source.meta === "object" ? (source.meta as Record<string, unknown>) : null;
  const degradedSource = typeof meta?.degradedSource === "string" ? meta.degradedSource : null;
  const failureClass =
    (typeof meta?.failureClass === "string" ? meta.failureClass : null) ??
    input.fallbackFailureClass ??
    null;
  const payloadInvalid = !Array.isArray(source.funds);
  const surfaceState = resolveCompareSurfaceState({
    requestedCount: input.requestedCodes.length,
    returnedCount: rows.length,
    failureClass,
    degradedSource,
    payloadInvalid,
  });
  return {
    surfaceState,
    funds: rows,
    compare,
    diagnostics: {
      requestedCount: input.requestedCodes.length,
      returnedCount: rows.length,
      rejectedRows: Math.max(0, rowsRaw.length - rows.length),
      degradedSource,
      failureClass,
    },
  };
}

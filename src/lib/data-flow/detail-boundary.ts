import type { DetailSurfaceState } from "@/lib/data-flow/contracts";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNonEmptyString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function normalizeReasons(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

export type DetailBoundaryResult =
  | {
      surfaceState: Extract<DetailSurfaceState, { kind: "ready" | "degraded_no_comparison_section" | "degraded_insufficient_rows" }>;
      payload: FundDetailPageData;
      diagnostics: {
        normalizedRows: number;
        rejectedRows: number;
        rejectedReason: string | null;
      };
    }
  | {
      surfaceState: Extract<DetailSurfaceState, { kind: "degraded_db_unavailable" | "degraded_invalid_payload" | "degraded_insufficient_data" }>;
      payload: null;
      diagnostics: {
        normalizedRows: number;
        rejectedRows: number;
        rejectedReason: string | null;
      };
    };

export function normalizeFundDetailPayloadAtBoundary(raw: unknown): DetailBoundaryResult {
  if (!raw || typeof raw !== "object") {
    return {
      surfaceState: { kind: "degraded_invalid_payload", reason: "detail_payload_not_object" },
      payload: null,
      diagnostics: { normalizedRows: 0, rejectedRows: 1, rejectedReason: "payload_not_object" },
    };
  }
  const candidate = raw as Partial<FundDetailPageData>;
  const fundCode = asNonEmptyString(candidate.fund?.code);
  const fundName = asNonEmptyString(candidate.fund?.name);
  if (!fundCode || !fundName) {
    return {
      surfaceState: { kind: "degraded_invalid_payload", reason: "detail_missing_fund_identity" },
      payload: null,
      diagnostics: { normalizedRows: 0, rejectedRows: 1, rejectedReason: "missing_fund_identity" },
    };
  }

  const degradedReasons = normalizeReasons(candidate.degraded?.reasons);
  if (degradedReasons.some((reason) => reason.includes("db_unavailable"))) {
    return {
      surfaceState: { kind: "degraded_db_unavailable" },
      payload: null,
      diagnostics: { normalizedRows: 0, rejectedRows: 1, rejectedReason: "db_unavailable" },
    };
  }

  const normalizedPriceSeries = Array.isArray(candidate.priceSeries)
    ? candidate.priceSeries
        .map((point) => ({ t: asFiniteNumber(point?.t, Number.NaN), p: asFiniteNumber(point?.p, Number.NaN) }))
        .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0)
    : [];

  if (normalizedPriceSeries.length < 2) {
    return {
      surfaceState: { kind: "degraded_insufficient_data" },
      payload: null,
      diagnostics: { normalizedRows: normalizedPriceSeries.length, rejectedRows: 1, rejectedReason: "insufficient_price_series" },
    };
  }

  const payload = {
    ...candidate,
    priceSeries: normalizedPriceSeries,
    similarFunds: Array.isArray(candidate.similarFunds) ? candidate.similarFunds.filter((item) => Boolean(item?.code?.trim())) : [],
    trendSeries: {
      investorCount: Array.isArray(candidate.trendSeries?.investorCount) ? candidate.trendSeries.investorCount : [],
      portfolioSize: Array.isArray(candidate.trendSeries?.portfolioSize) ? candidate.trendSeries.portfolioSize : [],
    },
  } as FundDetailPageData;

  const comparisonRows = payload.kiyasBlock
    ? Object.values(payload.kiyasBlock.rowsByRef ?? {}).flat().filter((row) => Number.isFinite(row?.fundPct) && Number.isFinite(row?.refPct))
    : [];

  if (!payload.kiyasBlock) {
    return {
      surfaceState: { kind: "degraded_no_comparison_section" },
      payload,
      diagnostics: { normalizedRows: normalizedPriceSeries.length, rejectedRows: 0, rejectedReason: null },
    };
  }
  if (comparisonRows.length === 0) {
    return {
      surfaceState: { kind: "degraded_insufficient_rows" },
      payload,
      diagnostics: { normalizedRows: normalizedPriceSeries.length, rejectedRows: 0, rejectedReason: "comparison_rows_empty" },
    };
  }
  return {
    surfaceState: { kind: "ready" },
    payload,
    diagnostics: { normalizedRows: normalizedPriceSeries.length, rejectedRows: 0, rejectedReason: null },
  };
}

import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import { fundTypeForApi } from "@/lib/fund-type-display";
import {
  loadCompareContext,
  type CompareContextDto,
} from "@/lib/services/compare-reference.service";
import {
  hasUsableCompareRows,
  shouldUseFastCompareContextFallback,
} from "@/lib/operational-hardening";
import {
  enforceServingRouteTrust,
  readServingComparePrimary,
  readServingFundListPrimary,
  servingHeaders,
} from "@/lib/data-platform/read-side-serving";
import { tryFormatDbRuntimeEvidenceOneLiner } from "@/lib/db-runtime-diagnostics";
import { resolveCompareSurfaceState } from "@/lib/data-flow/compare-boundary";
import { logCompareDataFlowEvidence } from "@/lib/data-flow/diagnostics";
import {
  isServingStrictModeEnabled,
  servingStrictHeaders,
} from "@/lib/data-platform/serving-strict-mode";
import { deriveFreshnessContract } from "@/lib/freshness-contract";
import { createComparePathTrace } from "@/lib/compare-path-instrumentation";
import { readUiServingWorldMetaCached } from "@/lib/domain/serving/ui-cutover-contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX = 4;
const CODE_RE = /^[A-Z0-9]{2,12}$/;
const COMPARE_ROUTE_SERVING_COMPARE_TIMEOUT_MS = Number(process.env.COMPARE_ROUTE_SERVING_COMPARE_TIMEOUT_MS ?? "1600");
const COMPARE_ROUTE_SERVING_FUND_LIST_TIMEOUT_MS = Number(process.env.COMPARE_ROUTE_SERVING_FUND_LIST_TIMEOUT_MS ?? "1600");
const COMPARE_CONTEXT_TIMEOUT_MS = Number(process.env.COMPARE_ROUTE_CONTEXT_TIMEOUT_MS ?? "900");
const COMPARE_FRESHNESS_FRESH_MS = Number(process.env.COMPARE_FRESHNESS_FRESH_MS ?? 6 * 60 * 60_000);
const COMPARE_FRESHNESS_STALE_MS = Number(process.env.COMPARE_FRESHNESS_STALE_MS ?? 36 * 60 * 60_000);

type CompareFundRow = {
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  categoryCode: string | null;
  categoryName: string | null;
  fundTypeCode: number | null;
  fundTypeName: string | null;
  categoryId: string | null;
  isActive: boolean;
};

type ContextLoadOutcome = {
  compare: CompareContextDto | null;
  extrasById: Record<string, { volatility1y: number | null; maxDrawdown1y: number | null; variabilityLabel: string | null }>;
  degraded: boolean;
  failureClass: string | null;
};
function deriveCompareHealth(input: {
  rowsUsable: boolean;
  degradedSource: string | null;
  contextDegraded: boolean;
}): { compareHealth: "healthy" | "degraded" | "invalid"; trustAsFinal: boolean } {
  if (!input.rowsUsable) return { compareHealth: "invalid", trustAsFinal: false };
  if (input.degradedSource || input.contextDegraded) return { compareHealth: "degraded", trustAsFinal: false };
  return { compareHealth: "healthy", trustAsFinal: true };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout_${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isTimeoutLike(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|aborted/i.test(message);
}

type ServingCompareEnvelope = Awaited<ReturnType<typeof readServingComparePrimary>>;
type ServingListEnvelope = Awaited<ReturnType<typeof readServingFundListPrimary>>;

function emptyServingCompareEnvelope(reason: string): ServingCompareEnvelope {
  return {
    world: null,
    payload: null,
    trust: { trustAsFinal: false, degradedKind: "serving_payload_missing", degradedReason: reason },
    envelopeRead: "latest_updated",
  };
}

function emptyServingListEnvelope(reason: string): ServingListEnvelope {
  return {
    world: null,
    payload: null,
    trust: { trustAsFinal: false, degradedKind: "serving_payload_missing", degradedReason: reason },
    envelopeRead: "latest_updated",
  };
}

function normalizeCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

function parseCodes(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  const parts = raw
    .split(/[,\s]+/)
    .map(normalizeCode)
    .filter(Boolean);
  return [...new Set(parts as string[])].slice(0, MAX);
}

function buildDegradedCompareContext(codes: string[]): CompareContextDto {
  return {
    anchorDate: new Date().toISOString(),
    refs: [],
    defaultRef: "category",
    periods: [
      { id: "1m", label: "1 Ay" },
      { id: "3m", label: "3 Ay" },
      { id: "6m", label: "6 Ay" },
      { id: "1y", label: "1 Yıl" },
      { id: "2y", label: "2 Yıl" },
      { id: "3y", label: "3 Yıl" },
    ],
    summaryByRef: {},
    matrix: Object.fromEntries(codes.map((code) => [code, {}])),
  };
}


async function loadContextForRows(rows: CompareFundRow[]): Promise<ContextLoadOutcome> {
  const orderedCodes = rows.map((row) => row.code.trim().toUpperCase());
  const internal = rows.map((it) => ({
    id: it.fundId,
    code: it.code,
    name: it.name,
    shortName: it.shortName,
    categoryId: it.categoryId,
    categoryCode: it.categoryCode ?? null,
    fundTypeCode: it.fundTypeCode ?? null,
    fundTypeName: it.fundTypeName ?? null,
  }));
  if (internal.length === 0) {
    return { compare: null, extrasById: {}, degraded: false, failureClass: null };
  }
  try {
    const built = await withTimeout(loadCompareContext(internal), COMPARE_CONTEXT_TIMEOUT_MS, "compare_context");
    return {
      compare: built?.context ?? null,
      extrasById: built?.extrasByFundId ?? {},
      degraded: false,
      failureClass: null,
    };
  } catch (error) {
    return {
      compare: buildDegradedCompareContext(orderedCodes),
      extrasById: {},
      degraded: true,
      failureClass: isTimeoutLike(error) ? "timeout" : "context_failed",
    };
  }
}

export async function GET(req: NextRequest) {
  const trace = createComparePathTrace("compare");
  try {
    const strictMode = isServingStrictModeEnabled(req);
    const metaStarted = performance.now();
    const servingWorldMeta = await readUiServingWorldMetaCached();
    trace.record(
      "serving_world_meta",
      Math.round(performance.now() - metaStarted),
      servingWorldMeta.buildIds.fundDetail ? "ok" : "empty"
    );
    const [servingCompare, servingList] = await Promise.all([
      (async () => {
        const s = performance.now();
        try {
          const v = await withTimeout(
            readServingComparePrimary(servingWorldMeta),
            COMPARE_ROUTE_SERVING_COMPARE_TIMEOUT_MS,
            "compare_route_serving_compare_primary"
          );
          const ms = Math.round(performance.now() - s);
          trace.record("serving_compare_primary", ms, v.payload ? "ok" : "empty");
          return v;
        } catch (e) {
          const ms = Math.round(performance.now() - s);
          trace.record(
            "serving_compare_primary",
            ms,
            isTimeoutLike(e) ? "timeout" : "error",
            isTimeoutLike(e) ? "db_or_serving_read" : undefined
          );
          return emptyServingCompareEnvelope("compare_serving_compare_primary_failed");
        }
      })(),
      (async () => {
        const s = performance.now();
        try {
          const v = await withTimeout(
            readServingFundListPrimary(servingWorldMeta),
            COMPARE_ROUTE_SERVING_FUND_LIST_TIMEOUT_MS,
            "compare_route_serving_fund_list_primary"
          );
          const ms = Math.round(performance.now() - s);
          trace.record("serving_fund_list_primary", ms, v.payload ? "ok" : "empty");
          return v;
        } catch (e) {
          const ms = Math.round(performance.now() - s);
          trace.record(
            "serving_fund_list_primary",
            ms,
            isTimeoutLike(e) ? "timeout" : "error",
            isTimeoutLike(e) ? "db_or_serving_read" : undefined
          );
          return emptyServingListEnvelope("compare_serving_fund_list_primary_failed");
        }
      })(),
    ]);
    const servingWorld = servingCompare.world ?? servingList.world ?? servingWorldMeta;
    const codes = parseCodes(req.nextUrl.searchParams.get("codes"));
    if (codes.length === 0) {
      const surfaceState = resolveCompareSurfaceState({
        requestedCount: 0,
        returnedCount: 0,
        failureClass: null,
        degradedSource: "empty_request",
        payloadInvalid: false,
      });
      return NextResponse.json(
        {
          funds: [] as const,
          compare: null as CompareContextDto | null,
          meta: {
            servingWorld,
            compareHealth: "invalid",
            trustAsFinal: false,
            degradedSource: "empty_request",
            failureClass: null,
            surfaceState,
          },
        },
        {
          headers: {
            "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
            ...trace.finish({ httpStatus: 200, classification: "empty_request", rowSource: "empty_request" }),
          },
        }
      );
    }

    const rows = (() => {
      if (!servingCompare.payload || !servingList.payload) return [] as CompareFundRow[];
      const selected = new Set(codes.map((code) => code.trim().toUpperCase()));
      const listByCode = new Map(
        servingList.payload.funds.map((fund) => [fund.code.trim().toUpperCase(), fund])
      );
      return servingCompare.payload.funds
        .filter((item) => selected.has(item.code.trim().toUpperCase()))
        .map((item) => {
          const list = listByCode.get(item.code.trim().toUpperCase());
          return {
            fundId: list?.code ?? item.code,
            code: item.code,
            name: list?.name ?? item.code,
            shortName: list?.shortName ?? null,
            logoUrl: null,
            lastPrice: list?.lastPrice ?? 0,
            dailyReturn: item.dailyReturn,
            monthlyReturn: item.monthlyReturn,
            yearlyReturn: item.yearlyReturn,
            portfolioSize: item.portfolioSize,
            investorCount: item.investorCount,
            categoryCode: item.categoryCode,
            categoryName: item.categoryCode,
            fundTypeCode: list?.fundTypeCode ?? null,
            fundTypeName: list?.fundTypeCode != null ? String(list.fundTypeCode) : null,
            categoryId: null,
            isActive: true,
          } satisfies CompareFundRow;
        });
    })();
    let degradedSource: string | null = rows.length > 0 ? "serving_compare_inputs" : "source_unavailable";

    const activeRows = rows.filter((row) => row.isActive);
    const byCode = new Map(activeRows.map((row) => [row.code.trim().toUpperCase(), row]));
    const ordered = codes.map((code) => byCode.get(code)).filter(Boolean) as CompareFundRow[];
    const ctxT = performance.now();
    const contextOutcome = shouldUseFastCompareContextFallback(ordered)
      ? {
          compare: buildDegradedCompareContext(ordered.map((row) => row.code.trim().toUpperCase())),
          extrasById: {},
          degraded: true,
          failureClass: "context_optional_skipped",
        }
      : await loadContextForRows(ordered);
    trace.record(
      "compare_context",
      Math.round(performance.now() - ctxT),
      contextOutcome.degraded ? "degraded" : "ok",
      contextOutcome.failureClass ?? undefined
    );
    const compare = contextOutcome.compare;
    const extrasById = contextOutcome.extrasById;
    if (contextOutcome.degraded && !degradedSource) degradedSource = "context_fallback";
    const rowsUsable = hasUsableCompareRows(ordered);
    const compareHealth = deriveCompareHealth({
      rowsUsable,
      degradedSource,
      contextDegraded: contextOutcome.degraded,
    });
    const routeTrust = enforceServingRouteTrust({
      world: servingWorld,
      source: "serving_compare_inputs",
      requiredBuilds: ["fundList", "compare", "system"],
      payloadAvailable: rowsUsable,
      fallbackUsed: degradedSource !== "serving_compare_inputs",
      fallbackReason: degradedSource ?? "serving_compare_unavailable",
    });
    const strictTrust = compareHealth.trustAsFinal && routeTrust.trustAsFinal;
    const freshness = deriveFreshnessContract({
      asOf: servingCompare.payload?.snapshotAsOf ?? servingList.payload?.snapshotAsOf ?? null,
      freshTtlMs: COMPARE_FRESHNESS_FRESH_MS,
      staleTtlMs: COMPARE_FRESHNESS_STALE_MS,
      unknownAsDegraded: degradedSource !== "serving_compare_inputs",
    });
    if (strictMode && (degradedSource !== "serving_compare_inputs" || !strictTrust)) {
      return NextResponse.json(
        {
          error: "serving_strict_violation",
          route: "/api/funds/compare",
          reason:
            degradedSource && degradedSource !== "serving_compare_inputs"
              ? degradedSource
              : routeTrust.degradedReason ?? "compare_not_final",
        },
        {
          status: 503,
          headers: {
            ...trace.finish({
              httpStatus: 503,
              classification: "strict_violation",
              failureClass: contextOutcome.failureClass,
              rowSource: degradedSource ?? null,
            }),
            ...servingHeaders({
              world: servingWorld,
              trust: {
                trustAsFinal: strictTrust,
                degradedKind: routeTrust.degradedKind,
                degradedReason: routeTrust.degradedReason,
              },
              routeSource: degradedSource ?? "unknown",
              fallbackUsed: degradedSource !== "serving_compare_inputs",
            }),
            ...servingStrictHeaders({
              enabled: strictMode,
              violated: true,
              reason:
                degradedSource && degradedSource !== "serving_compare_inputs"
                  ? degradedSource
                  : routeTrust.degradedReason ?? "compare_not_final",
            }),
          },
        }
      );
    }

    const funds = ordered.map((it) => {
      const ex = extrasById[it.fundId] ?? {
        volatility1y: null,
        maxDrawdown1y: null,
        variabilityLabel: null,
      };
      return {
        code: it.code,
        name: it.name,
        shortName: it.shortName,
        logoUrl: getFundLogoUrlForUi(it.fundId, it.code, it.logoUrl, it.name),
        lastPrice: it.lastPrice,
        dailyReturn: it.dailyReturn,
        monthlyReturn: it.monthlyReturn,
        yearlyReturn: it.yearlyReturn,
        portfolioSize: it.portfolioSize,
        investorCount: it.investorCount,
        category:
          it.categoryCode && it.categoryName
            ? { code: it.categoryCode, name: it.categoryName }
            : null,
        fundType:
          it.fundTypeCode != null && it.fundTypeName
            ? fundTypeForApi({ code: it.fundTypeCode, name: it.fundTypeName })
            : null,
        volatility1y: ex.volatility1y,
        maxDrawdown1y: ex.maxDrawdown1y,
        variabilityLabel: ex.variabilityLabel,
      };
    });

    if (codes.length >= 2 && funds.length < 2) {
      console.warn(
        `[funds/compare-insufficient] requested=${codes.join(",")} returned_funds=${funds.length} ` +
          `degraded_source=${degradedSource ?? "none"} compare_health=${compareHealth.compareHealth} ` +
          `evidence=${tryFormatDbRuntimeEvidenceOneLiner()}`
      );
    }
    const surfaceState = resolveCompareSurfaceState({
      requestedCount: codes.length,
      returnedCount: funds.length,
      failureClass: contextOutcome.failureClass,
      degradedSource: degradedSource ?? null,
      payloadInvalid: false,
    });
    logCompareDataFlowEvidence({
      requestedCount: codes.length,
      returnedCount: funds.length,
      surfaceState: surfaceState.kind,
      degradedSource: degradedSource ?? null,
      failureClass: contextOutcome.failureClass,
      compareHealth: compareHealth.compareHealth,
    });

    return NextResponse.json(
      {
        funds,
        compare,
        meta: {
          servingWorld,
          freshness,
          compareHealth: compareHealth.compareHealth,
          trustAsFinal: compareHealth.trustAsFinal && routeTrust.trustAsFinal,
          degradedSource: degradedSource ?? null,
          failureClass: contextOutcome.failureClass,
          surfaceState,
        },
      },
      {
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
          ...trace.finish({
            httpStatus: 200,
            classification: compareHealth.compareHealth === "healthy" ? "ok" : "degraded_response",
            failureClass: contextOutcome.failureClass,
            rowSource: degradedSource ?? null,
          }),
          ...(degradedSource ? { "X-Compare-Degraded-Source": degradedSource } : {}),
          ...(contextOutcome.failureClass ? { "X-Compare-Failure-Class": contextOutcome.failureClass } : {}),
          "X-Compare-Health": compareHealth.compareHealth,
          "X-Compare-Trust-Final": compareHealth.trustAsFinal ? "1" : "0",
          "X-Data-Freshness-State": freshness.state,
          "X-Data-Freshness-Reason": freshness.reason,
          "X-Data-Freshness-As-Of": freshness.asOf ?? "unknown",
          "X-Data-Freshness-Age-Ms": freshness.ageMs == null ? "unknown" : String(freshness.ageMs),
          ...servingStrictHeaders({ enabled: strictMode, violated: false }),
          ...servingHeaders({
            world: servingWorld,
            trust: {
              trustAsFinal: strictTrust,
              degradedKind: routeTrust.degradedKind,
              degradedReason: routeTrust.degradedReason,
            },
            routeSource: degradedSource ?? "unknown",
            fallbackUsed: degradedSource !== "serving_compare_inputs",
          }),
        },
      }
    );
  } catch (e) {
    const strictMode = isServingStrictModeEnabled(req);
    if (strictMode) {
      return NextResponse.json(
        {
          error: "serving_strict_violation",
          route: "/api/funds/compare",
          reason: "exception_requires_fallback",
        },
        {
          status: 503,
          headers: {
            ...trace.finish({
              httpStatus: 503,
              classification: "strict_exception",
              failureClass: "exception_requires_fallback",
            }),
            ...servingStrictHeaders({
              enabled: strictMode,
              violated: true,
              reason: "exception_requires_fallback",
            }),
          },
        }
      );
    }
    const codes = parseCodes(req.nextUrl.searchParams.get("codes"));
    if (process.env.NODE_ENV !== "production") {
      console.error("[funds/compare]", e);
    }
    return NextResponse.json(
      { error: "compare_failed" },
      {
        status: 500,
        headers: trace.finish({
          httpStatus: 500,
          classification: "server_error",
          failureClass: isTimeoutLike(e) ? "timeout" : "compare_failed",
        }),
      }
    );
  }
}

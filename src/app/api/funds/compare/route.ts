import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import { prisma } from "@/lib/prisma";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import { fundTypeForApi } from "@/lib/fund-type-display";
import {
  getFundDetailCoreServingCached,
  getFundDetailCoreServingUniversePayloads,
} from "@/lib/services/fund-detail-core-serving.service";
import {
  loadCompareContext,
  type CompareContextDto,
} from "@/lib/services/compare-reference.service";
import { readServingPayloadForCompareSeries } from "@/lib/services/compare-series-resolution";
import {
  hasUsableCompareRows,
  shouldUseFastCompareContextFallback,
} from "@/lib/operational-hardening";
import { readActiveRegistryFundsByCodes } from "@/lib/services/fund-registry-read.service";
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
const COMPARE_DB_TIMEOUT_MS = Number(process.env.COMPARE_ROUTE_DB_TIMEOUT_MS ?? "1400");
const COMPARE_CONTEXT_TIMEOUT_MS = Number(process.env.COMPARE_ROUTE_CONTEXT_TIMEOUT_MS ?? "900");
const COMPARE_SERVING_UNIVERSE_TIMEOUT_MS = Number(process.env.COMPARE_ROUTE_SERVING_UNIVERSE_TIMEOUT_MS ?? "1400");
const COMPARE_SERVING_CODE_TIMEOUT_MS = Number(process.env.COMPARE_ROUTE_SERVING_CODE_TIMEOUT_MS ?? "1800");
const COMPARE_REGISTRY_TIMEOUT_MS = Number(process.env.COMPARE_ROUTE_REGISTRY_TIMEOUT_MS ?? "1800");
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
  fallbackOnly?: boolean;
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
  };
}

function emptyServingListEnvelope(reason: string): ServingListEnvelope {
  return {
    world: null,
    payload: null,
    trust: { trustAsFinal: false, degradedKind: "serving_payload_missing", degradedReason: reason },
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

async function loadRowsFromSnapshot(codes: string[]): Promise<CompareFundRow[]> {
  const latest = await withTimeout(
    prisma.fundDailySnapshot.findFirst({
      orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
      select: { date: true },
    }),
    COMPARE_DB_TIMEOUT_MS,
    "compare_latest_snapshot"
  );
  if (!latest) return [];
  const rows = await withTimeout(
    prisma.fundDailySnapshot.findMany({
      where: {
        date: latest.date,
        code: { in: codes },
      },
      select: {
        fundId: true,
        code: true,
        name: true,
        shortName: true,
        logoUrl: true,
        lastPrice: true,
        dailyReturn: true,
        monthlyReturn: true,
        yearlyReturn: true,
        portfolioSize: true,
        investorCount: true,
        categoryCode: true,
        categoryName: true,
        fundTypeCode: true,
        fundTypeName: true,
        fund: {
          select: {
            isActive: true,
            categoryId: true,
            logoUrl: true,
          },
        },
      },
    }),
    COMPARE_DB_TIMEOUT_MS,
    "compare_snapshot_rows"
  );
  return rows.map((row) => ({
    fundId: row.fundId,
    code: row.code,
    name: row.name,
    shortName: row.shortName,
    logoUrl: row.logoUrl ?? row.fund.logoUrl,
    lastPrice: row.lastPrice,
    dailyReturn: row.dailyReturn,
    monthlyReturn: row.monthlyReturn,
    yearlyReturn: row.yearlyReturn,
    portfolioSize: row.portfolioSize,
    investorCount: row.investorCount,
    categoryCode: row.categoryCode,
    categoryName: row.categoryName,
    fundTypeCode: row.fundTypeCode,
    fundTypeName: row.fundTypeName,
    categoryId: row.fund.categoryId,
    isActive: row.fund.isActive,
  }));
}

async function loadRowsFromServing(codes: string[]): Promise<CompareFundRow[]> {
  const requested = new Set(codes.map((code) => code.trim().toUpperCase()));
  const reads = await Promise.all(
    codes.map(async (code) => {
      try {
        return await withTimeout(
          readServingPayloadForCompareSeries(code, getFundDetailCoreServingCached),
          COMPARE_SERVING_CODE_TIMEOUT_MS,
          "compare_serving_code"
        );
      } catch {
        return { payload: null };
      }
    })
  );
  const rowsFromCodeReads = reads
    .map((read) => read.payload)
    .filter((payload): payload is NonNullable<(typeof reads)[number]["payload"]> => payload != null)
    .map((payload) => ({
      fundId: payload.fund.fundId,
      code: payload.fund.code,
      name: payload.fund.name,
      shortName: payload.fund.shortName,
      logoUrl: payload.fund.logoUrl,
      lastPrice: payload.latestPrice,
      dailyReturn: payload.dailyChangePct,
      monthlyReturn: payload.monthlyReturn,
      yearlyReturn: payload.yearlyReturn,
      portfolioSize: payload.portfolioSummary.current,
      investorCount: payload.investorSummary.current,
      categoryCode: payload.fund.categoryCode,
      categoryName: payload.fund.categoryName,
      fundTypeCode: payload.fund.fundTypeCode,
      fundTypeName: payload.fund.fundTypeName,
      categoryId: null,
      isActive: true,
      fallbackOnly: true,
    }));
  if (rowsFromCodeReads.length >= Math.min(codes.length, MAX)) return rowsFromCodeReads;

  const foundCodes = new Set(rowsFromCodeReads.map((row) => row.code.trim().toUpperCase()));
  const universe = await withTimeout(
    getFundDetailCoreServingUniversePayloads(),
    COMPARE_SERVING_UNIVERSE_TIMEOUT_MS,
    "compare_serving_universe"
  ).catch(() => null);
  const rowsFromUniverse =
    universe?.records
      .filter((payload) => requested.has(payload.fund.code.trim().toUpperCase()))
      .filter((payload) => !foundCodes.has(payload.fund.code.trim().toUpperCase()))
      .map((payload) => ({
        fundId: payload.fund.fundId,
        code: payload.fund.code,
        name: payload.fund.name,
        shortName: payload.fund.shortName,
        logoUrl: payload.fund.logoUrl,
        lastPrice: payload.latestPrice,
        dailyReturn: payload.dailyChangePct,
        monthlyReturn: payload.monthlyReturn,
        yearlyReturn: payload.yearlyReturn,
        portfolioSize: payload.portfolioSummary.current,
        investorCount: payload.investorSummary.current,
        categoryCode: payload.fund.categoryCode,
        categoryName: payload.fund.categoryName,
        fundTypeCode: payload.fund.fundTypeCode,
        fundTypeName: payload.fund.fundTypeName,
        categoryId: null,
        isActive: true,
        fallbackOnly: true,
      })) ?? [];

  return [...rowsFromCodeReads, ...rowsFromUniverse];
}

async function loadRowsFromFundRegistry(codes: string[]): Promise<CompareFundRow[]> {
  const rows = await withTimeout(
    readActiveRegistryFundsByCodes(codes),
    COMPARE_REGISTRY_TIMEOUT_MS,
    "compare_registry_rows"
  ).catch(() => []);
  return rows.map((row) => ({
    fundId: row.id,
    code: row.code,
    name: row.name,
    shortName: row.shortName,
    logoUrl: row.logoUrl,
    lastPrice: row.lastPrice,
    dailyReturn: row.dailyReturn,
    monthlyReturn: 0,
    yearlyReturn: 0,
    portfolioSize: row.portfolioSize,
    investorCount: row.investorCount,
    categoryCode: null,
    categoryName: null,
    fundTypeCode: null,
    fundTypeName: null,
    categoryId: null,
    isActive: true,
    fallbackOnly: true,
  }));
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
    const [servingCompare, servingList, servingWorldMeta] = await Promise.all([
      (async () => {
        const s = performance.now();
        try {
          const v = await withTimeout(
            readServingComparePrimary(),
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
            readServingFundListPrimary(),
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
      (async () => {
        const s = performance.now();
        const v = await readUiServingWorldMetaCached();
        trace.record(
          "serving_world_meta",
          Math.round(performance.now() - s),
          v.buildIds.fundDetail ? "ok" : "empty"
        );
        return v;
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

    let rows = (() => {
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
    let degradedSource: string | null = null;
    if (rows.length > 0) degradedSource = "serving_compare_inputs";
    if (rows.length === 0) {
      const snapT = performance.now();
      rows = await loadRowsFromSnapshot(codes).catch(() => []);
      trace.record(
        "snapshot_rows",
        Math.round(performance.now() - snapT),
        rows.length > 0 ? "ok" : "empty"
      );
      if (rows.length > 0) degradedSource = "snapshot_fallback";
    }
    if (rows.length === 0) {
      const regT = performance.now();
      rows = await loadRowsFromFundRegistry(codes).catch(() => []);
      trace.record(
        "registry_rows",
        Math.round(performance.now() - regT),
        rows.length > 0 ? "ok" : "empty"
      );
      if (rows.length > 0) degradedSource = "registry";
    }

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
    if (!rowsUsable) degradedSource = degradedSource ?? "empty_or_unusable";
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
    const servingRows = codes.length > 0 ? await loadRowsFromServing(codes).catch(() => []) : [];
    if (servingRows.length > 0) {
      const byCode = new Map(servingRows.map((row) => [row.code.trim().toUpperCase(), row]));
      const ordered = codes.map((code) => byCode.get(code)).filter(Boolean) as CompareFundRow[];
      const fallbackFunds = ordered.map((it) => ({
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
        volatility1y: null,
        maxDrawdown1y: null,
        variabilityLabel: null,
      }));
      const failureClass = isTimeoutLike(e) ? "timeout" : "compare_failed";
      const surfaceState = resolveCompareSurfaceState({
        requestedCount: codes.length,
        returnedCount: fallbackFunds.length,
        failureClass,
        degradedSource: "serving_exception_fallback",
        payloadInvalid: false,
      });
      logCompareDataFlowEvidence({
        requestedCount: codes.length,
        returnedCount: fallbackFunds.length,
        surfaceState: surfaceState.kind,
        degradedSource: "serving_exception_fallback",
        failureClass,
      });
      return NextResponse.json(
        {
          funds: fallbackFunds,
          compare: buildDegradedCompareContext(ordered.map((row) => row.code.trim().toUpperCase())),
          meta: {
            degradedSource: "serving_exception_fallback",
            failureClass,
            surfaceState,
          },
        },
        {
          headers: {
            "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
            ...trace.finish({
              httpStatus: 200,
              classification: "exception_fallback_rows",
              failureClass,
              rowSource: "serving_exception_fallback",
            }),
            "X-Compare-Degraded-Source": "serving_exception_fallback",
            "X-Compare-Failure-Class": failureClass,
          },
        }
      );
    }
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

import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import { getFundsPage, type FundListSortField } from "@/lib/services/fund-list.service";
import { classifyDatabaseError } from "@/lib/database-error-classifier";
import { getDbEnvStatus, sanitizeFailureDetail } from "@/lib/db-env-validation";
import { listFundDetailCoreServingRows } from "@/lib/services/fund-detail-core-serving.service";
import { getScoresPayloadServerCachedSafe } from "@/lib/services/fund-scores-cache.service";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import {
  enforceServingRouteTrust,
  readServingFundListPrimary,
  servingHeaders,
  type ServingListRow,
} from "@/lib/data-platform/read-side-serving";
import { readUiServingWorldMetaCached, type UiServingWorldMeta } from "@/lib/domain/serving/ui-cutover-contract";
import {
  isServingStrictModeEnabled,
  servingStrictHeaders,
} from "@/lib/data-platform/serving-strict-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PAGE = 200;
const MAX_PAGE_SIZE = 100;
const MAX_QUERY_LENGTH = 64;
const MAX_FILTER_LENGTH = 32;
const FUNDS_TIMEOUT_MS = parseEnvMs("FUNDS_ROUTE_TIMEOUT_MS", 5_000, 2_500, 20_000);
const FUNDS_CACHE_TTL_MS = parseEnvMs("FUNDS_ROUTE_CACHE_TTL_MS", 90_000, 10_000, 10 * 60_000);
const FUNDS_STALE_TTL_MS = parseEnvMs("FUNDS_ROUTE_STALE_TTL_MS", 10 * 60_000, 30_000, 60 * 60_000);
const FUNDS_LIGHT_SERVING_LIMIT = parseEnvMs("FUNDS_LIGHT_SERVING_LIMIT", 400, 30, 3200);
const FUNDS_SCORES_CACHE_FALLBACK_TIMEOUT_MS = parseEnvMs(
  "FUNDS_SCORES_CACHE_FALLBACK_TIMEOUT_MS",
  1_800,
  600,
  6_000
);

type FundsPayload = {
  items: Array<{
    id: string;
    code: string;
    name: string;
    shortName: string | null;
    logoUrl: string | null;
    portfolioSize: number;
    lastPrice: number;
    dailyReturn: number;
    weeklyReturn: number;
    monthlyReturn: number;
    yearlyReturn: number;
    investorCount: number;
    shareCount: number;
    category: { code: string; name: string; color: string | null } | null;
    fundType: { code: number; name: string } | null;
    sparkline: number[];
    sparklineTrend: "up" | "down" | "flat";
  }>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type FundsCacheEntry = {
  payload: FundsPayload;
  updatedAt: number;
  /** Son başarılı serving yanıtından; cache hit'te DB world meta çağrısı yapmamak için. */
  servingWorldForHeaders?: UiServingWorldMeta | null;
};

type FundsRuntimeState = {
  cache: Map<string, FundsCacheEntry>;
};

type GlobalWithFundsState = typeof globalThis & {
  __fundsRouteState?: FundsRuntimeState;
};

function parseEnvMs(name: string, fallback: number, min: number, max: number): number {
  const rawValue = process.env[name];
  if (typeof rawValue !== "string" || rawValue.trim() === "") return fallback;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

const SORT_FIELDS = new Set<FundListSortField>([
  "portfolioSize",
  "dailyReturn",
  "lastPrice",
  "investorCount",
  "weeklyReturn",
  "monthlyReturn",
  "yearlyReturn",
]);

function getFundsRouteState(): FundsRuntimeState {
  const g = globalThis as GlobalWithFundsState;
  if (!g.__fundsRouteState) {
    g.__fundsRouteState = { cache: new Map<string, FundsCacheEntry>() };
  }
  return g.__fundsRouteState;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`funds_timeout_${timeoutMs}ms`)), timeoutMs);
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

function isFundsTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("funds_timeout_");
}

function shouldFastDegradeForDb(category: string): boolean {
  return (
    category === "pool_checkout_timeout" ||
    category === "query_execution_timeout" ||
    category === "transaction_timeout" ||
    category === "connection_closed" ||
    category === "connect_timeout" ||
    category === "network_unreachable"
  );
}

function toFundsPayloadRow(row: ServingListRow) {
  return {
    id: row.code,
    code: row.code,
    name: row.name,
    shortName: row.shortName,
    // Serving fund-list payload'ı `logoUrl` taşımıyor; isim tabanlı kural
    // (PORTFOLIO_COMPANY_RULES) ve manifest üzerinden çözüp boş slotları engelliyoruz.
    logoUrl: getFundLogoUrlForUi(row.code, row.code, null, row.name),
    portfolioSize: row.portfolioSize,
    lastPrice: row.lastPrice,
    dailyReturn: row.dailyReturn,
    weeklyReturn: 0,
    monthlyReturn: row.monthlyReturn,
    yearlyReturn: row.yearlyReturn,
    investorCount: Math.round(row.investorCount),
    shareCount: 0,
    category:
      row.categoryCode
        ? { code: row.categoryCode, name: row.categoryCode, color: null }
        : null,
    fundType: row.fundTypeCode != null ? { code: row.fundTypeCode, name: String(row.fundTypeCode) } : null,
    sparkline: [] as number[],
    sparklineTrend:
      row.dailyReturn > 0 ? ("up" as const) : row.dailyReturn < 0 ? ("down" as const) : ("flat" as const),
  };
}

function readSortableValue(row: ServingListRow, field: FundListSortField): number {
  if (field === "portfolioSize") return row.portfolioSize;
  if (field === "dailyReturn") return row.dailyReturn;
  if (field === "lastPrice") return row.lastPrice;
  if (field === "investorCount") return row.investorCount;
  if (field === "monthlyReturn") return row.monthlyReturn;
  if (field === "yearlyReturn") return row.yearlyReturn;
  return 0;
}

function queryMatchesRow(row: ServingListRow, qLower: string): boolean {
  if (!qLower) return true;
  return row.searchHaystack.includes(qLower);
}

function buildPrimaryServingFundsPage(input: {
  rows: ServingListRow[];
  page: number;
  pageSize: number;
  q: string;
  category: string;
  fundType: string;
  sortField: FundListSortField;
  sortDir: "asc" | "desc";
}): FundsPayload {
  const filtered = input.rows
    .filter((row) => queryMatchesRow(row, input.q))
    .filter((row) => (input.category ? row.categoryCode === input.category : true))
    .filter((row) => (input.fundType ? String(row.fundTypeCode ?? "") === input.fundType : true));
  filtered.sort((left, right) => {
    const delta = readSortableValue(left, input.sortField) - readSortableValue(right, input.sortField);
    if (delta !== 0) return input.sortDir === "asc" ? delta : -delta;
    return left.code.localeCompare(right.code, "tr", { sensitivity: "base" });
  });
  const start = Math.max(0, (input.page - 1) * input.pageSize);
  const pageRows = filtered.slice(start, start + input.pageSize);
  return {
    items: pageRows.map(toFundsPayloadRow),
    page: input.page,
    pageSize: input.pageSize,
    total: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / input.pageSize)),
  };
}

async function buildServingFundsFallback(page: number, pageSize: number): Promise<FundsPayload> {
  const list = await listFundDetailCoreServingRows(Math.max(FUNDS_LIGHT_SERVING_LIMIT, page * pageSize + pageSize));
  if (list.rows.length === 0) {
    return { items: [], page, pageSize, total: 0, totalPages: 1 };
  }
  const start = Math.max(0, (page - 1) * pageSize);
  const end = start + pageSize;
  const sliced = list.rows.slice(start, end);
  return {
    items: sliced.map((row) => ({
      id: row.fundId,
      code: row.code,
      name: row.name,
      shortName: row.shortName,
      logoUrl: row.logoUrl,
      portfolioSize: row.portfolioSize,
      lastPrice: row.lastPrice,
      dailyReturn: row.dailyReturn,
      weeklyReturn: 0,
      monthlyReturn: row.monthlyReturn,
      yearlyReturn: row.yearlyReturn,
      investorCount: row.investorCount,
      shareCount: 0,
      category:
        row.categoryCode && row.categoryName
          ? { code: row.categoryCode, name: row.categoryName, color: null }
          : null,
      fundType:
        row.fundTypeCode != null && row.fundTypeName
          ? { code: row.fundTypeCode, name: row.fundTypeName }
          : null,
      sparkline: [],
      sparklineTrend:
        row.dailyReturn > 0 ? ("up" as const) : row.dailyReturn < 0 ? ("down" as const) : ("flat" as const),
    })),
    page,
    pageSize,
    total: list.rows.length,
    totalPages: Math.max(1, Math.ceil(list.rows.length / pageSize)),
  };
}

async function buildScoresCacheFundsFallback(input: {
  page: number;
  pageSize: number;
  q: string;
  category: string;
  fundType: string;
  sortField: FundListSortField;
  sortDir: "asc" | "desc";
}): Promise<FundsPayload> {
  const payload = await withTimeout(
    getScoresPayloadServerCachedSafe("BEST", "", input.q),
    FUNDS_SCORES_CACHE_FALLBACK_TIMEOUT_MS
  ).catch(() => null);
  const funds = payload?.funds ?? [];
  const filtered = funds
    .filter((fund) => (input.category ? fund.category?.code === input.category : true))
    .filter((fund) => (input.fundType ? String(fund.fundType?.code ?? "") === input.fundType : true));
  filtered.sort((a, b) => {
    const left = Number(a[input.sortField as keyof typeof a] ?? 0);
    const right = Number(b[input.sortField as keyof typeof b] ?? 0);
    const delta = left - right;
    if (delta !== 0) return input.sortDir === "asc" ? delta : -delta;
    return a.code.localeCompare(b.code, "tr", { sensitivity: "base" });
  });
  const start = Math.max(0, (input.page - 1) * input.pageSize);
  const rows = filtered.slice(start, start + input.pageSize);
  return {
    items: rows.map((row) => ({
      id: row.fundId,
      code: row.code,
      name: row.name,
      shortName: row.shortName,
      logoUrl: row.logoUrl,
      portfolioSize: row.portfolioSize,
      lastPrice: row.lastPrice,
      dailyReturn: row.dailyReturn,
      weeklyReturn: 0,
      monthlyReturn: 0,
      yearlyReturn: 0,
      investorCount: row.investorCount,
      shareCount: 0,
      category: row.category ? { ...row.category, color: null } : null,
      fundType: row.fundType,
      sparkline: [],
      sparklineTrend:
        row.dailyReturn > 0 ? ("up" as const) : row.dailyReturn < 0 ? ("down" as const) : ("flat" as const),
    })),
    page: input.page,
    pageSize: input.pageSize,
    total: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / input.pageSize)),
  };
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const strictMode = isServingStrictModeEnabled(req);
  const dbEnvStatus = getDbEnvStatus();
  const dbHeaders = {
    "X-Db-Env-Status": dbEnvStatus.failureCategory ?? "ok",
    "X-Db-Connection-Mode": dbEnvStatus.connectionMode,
  };
  try {
    const { searchParams } = req.nextUrl;
    const page = Math.min(MAX_PAGE, Math.max(1, Number(searchParams.get("page") ?? "1")));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("pageSize") ?? "50")));
    const q = (searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH).toLocaleLowerCase("tr-TR");
    const category = (searchParams.get("category") ?? "").trim().slice(0, MAX_FILTER_LENGTH);
    const fundType = (searchParams.get("fundType") ?? "").trim().slice(0, 8);
    const sort = searchParams.get("sort") ?? "portfolioSize:desc";
    const rawField = sort.split(":")[0] ?? "portfolioSize";
    const sortDirRaw = sort.split(":")[1];
    const sortField: FundListSortField = SORT_FIELDS.has(rawField as FundListSortField)
      ? (rawField as FundListSortField)
      : "portfolioSize";
    const sortDir = sortDirRaw === "asc" ? "asc" : "desc";
    const cacheKey = [page, pageSize, q, category, fundType, sortField, sortDir].join("|");
    const state = getFundsRouteState();
    const cached = state.cache.get(cacheKey);
    if (!strictMode && cached && Date.now() - cached.updatedAt <= FUNDS_CACHE_TTL_MS) {
      const servingWorld = cached.servingWorldForHeaders ?? null;
      return NextResponse.json(cached.payload, {
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
          "X-Funds-Cache": "hit",
          "X-Funds-Source": "memory",
          "X-Db-Failure-Class": "none",
          "X-Serving-World-Id": servingWorld?.worldId ?? "none",
          "X-Serving-World-Aligned": servingWorld?.worldAligned ? "1" : "0",
          "X-Serving-FundList-Build-Id": servingWorld?.buildIds.fundList ?? "none",
          ...servingStrictHeaders({ enabled: strictMode, violated: false }),
          ...dbHeaders,
        },
      });
    }

    const servingPrimary = await readServingFundListPrimary();
    const servingWorld = servingPrimary.world;
    const hasServingPrimary = Boolean(servingPrimary.payload?.funds.length);
    const routeTrust = enforceServingRouteTrust({
      world: servingWorld,
      source: "serving_fund_list",
      requiredBuilds: ["fundList", "system"],
      payloadAvailable: hasServingPrimary,
      fallbackUsed: !hasServingPrimary,
      fallbackReason: hasServingPrimary ? null : "serving_list_unavailable",
    });
    if (strictMode && (!hasServingPrimary || !routeTrust.trustAsFinal)) {
      return NextResponse.json(
        {
          error: "serving_strict_violation",
          route: "/api/funds",
          reason: routeTrust.degradedReason ?? "strict_mode_requires_serving_primary",
          degradedKind: routeTrust.degradedKind,
        },
        {
          status: 503,
          headers: {
            ...servingHeaders({
              world: servingWorld,
              trust: routeTrust,
              routeSource: hasServingPrimary ? "serving_fund_list" : "legacy_fallback",
              fallbackUsed: !hasServingPrimary,
            }),
            ...servingStrictHeaders({
              enabled: strictMode,
              violated: true,
              reason: routeTrust.degradedReason ?? routeTrust.degradedKind,
            }),
            ...dbHeaders,
          },
        }
      );
    }
    const payload: FundsPayload = hasServingPrimary
      ? buildPrimaryServingFundsPage({
          rows: servingPrimary.payload?.funds ?? [],
          page,
          pageSize,
          q,
          category,
          fundType,
          sortField,
          sortDir,
        })
      : await withTimeout(
          getFundsPage({
            page,
            pageSize,
            q,
            category,
            fundType,
            sortField,
            sortDir,
          }).then((result) => ({
            items: result.items.map((item) => ({
              ...item,
              sparkline: [] as number[],
              sparklineTrend:
                item.dailyReturn > 0 ? "up" : item.dailyReturn < 0 ? ("down" as const) : ("flat" as const),
            })),
            page,
            pageSize: result.pageSize,
            total: result.total,
            totalPages: result.totalPages,
          })),
          FUNDS_TIMEOUT_MS
        );
    if (payload.items.length === 0) {
      const scoresFallback = await buildScoresCacheFundsFallback({
        page,
        pageSize,
        q,
        category,
        fundType,
        sortField,
        sortDir,
      });
      if (scoresFallback.items.length > 0) {
        state.cache.set(cacheKey, { payload: scoresFallback, updatedAt: Date.now(), servingWorldForHeaders: servingWorld });
        return NextResponse.json(scoresFallback, {
          headers: {
            "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
            "X-Funds-Cache": "scores-cache",
            "X-Funds-Source": "scores-cache",
            "X-Funds-Degraded": "empty_result_repaired",
            "X-Db-Failure-Class": "none",
            "X-Serving-World-Id": servingWorld?.worldId ?? "none",
            "X-Serving-World-Aligned": servingWorld?.worldAligned ? "1" : "0",
            "X-Serving-FundList-Build-Id": servingWorld?.buildIds.fundList ?? "none",
          ...servingStrictHeaders({ enabled: strictMode, violated: false }),
            ...dbHeaders,
          },
        });
      }
      const servingEmptyRepair = await buildServingFundsFallback(page, pageSize);
      if (servingEmptyRepair.items.length > 0) {
        state.cache.set(cacheKey, {
          payload: servingEmptyRepair,
          updatedAt: Date.now(),
          servingWorldForHeaders: servingWorld,
        });
        return NextResponse.json(servingEmptyRepair, {
          headers: {
            "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
            "X-Funds-Cache": "serving-empty-repair",
            "X-Funds-Source": "serving",
            "X-Funds-Degraded": "empty_primary_repaired",
            "X-Db-Failure-Class": "none",
            "X-Serving-World-Id": servingWorld?.worldId ?? "none",
            "X-Serving-World-Aligned": servingWorld?.worldAligned ? "1" : "0",
            "X-Serving-FundList-Build-Id": servingWorld?.buildIds.fundList ?? "none",
            ...servingStrictHeaders({ enabled: strictMode, violated: false }),
            ...dbHeaders,
          },
        });
      }
    }
    state.cache.set(cacheKey, { payload, updatedAt: Date.now(), servingWorldForHeaders: servingWorld });

    return NextResponse.json(
      {
        ...payload,
        meta: {
          servingWorld,
          trustAsFinal: routeTrust.trustAsFinal,
          degradedKind: routeTrust.degradedKind,
          degradedReason: routeTrust.degradedReason,
        },
      },
      {
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
          "X-Funds-Cache": "miss",
          "X-Funds-Source": hasServingPrimary ? "serving_fund_list" : "legacy_fallback",
          "X-Db-Failure-Class": "none",
          ...servingHeaders({
            world: servingWorld,
            trust: routeTrust,
            routeSource: hasServingPrimary ? "serving_fund_list" : "legacy_fallback",
            fallbackUsed: !hasServingPrimary,
          }),
          ...servingStrictHeaders({ enabled: strictMode, violated: false }),
          ...dbHeaders,
        },
      }
    );
  } catch (e) {
    const servingWorld = await readUiServingWorldMetaCached().catch(() => null);
    const { searchParams } = req.nextUrl;
    const page = Math.min(MAX_PAGE, Math.max(1, Number(searchParams.get("page") ?? "1")));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("pageSize") ?? "50")));
    const q = (searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH).toLocaleLowerCase("tr-TR");
    const category = (searchParams.get("category") ?? "").trim().slice(0, MAX_FILTER_LENGTH);
    const fundType = (searchParams.get("fundType") ?? "").trim().slice(0, 8);
    const sort = searchParams.get("sort") ?? "portfolioSize:desc";
    const rawField = sort.split(":")[0] ?? "portfolioSize";
    const sortDirRaw = sort.split(":")[1];
    const sortField: FundListSortField = SORT_FIELDS.has(rawField as FundListSortField)
      ? (rawField as FundListSortField)
      : "portfolioSize";
    const sortDir = sortDirRaw === "asc" ? "asc" : "desc";
    const cacheKey = [page, pageSize, q, category, fundType, sortField, sortDir].join("|");
    const state = getFundsRouteState();
    const stale = state.cache.get(cacheKey);
    if (strictMode) {
      return NextResponse.json(
        {
          error: "serving_strict_violation",
          route: "/api/funds",
          reason: "exception_path_requires_fallback",
        },
        {
          status: 503,
          headers: {
            ...servingStrictHeaders({
              enabled: strictMode,
              violated: true,
              reason: "exception_path_requires_fallback",
            }),
            ...dbHeaders,
          },
        }
      );
    }
    if (stale && Date.now() - stale.updatedAt <= FUNDS_STALE_TTL_MS) {
      return NextResponse.json(stale.payload, {
        status: 200,
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
          "X-Funds-Cache": "stale",
          "X-Funds-Source": "memory",
          "X-Db-Failure-Class": "none",
          ...dbHeaders,
        },
      });
    }

    const classified = classifyDatabaseError(e);
    if (isFundsTimeoutError(e) || shouldFastDegradeForDb(classified.category)) {
      const servingFallback = await buildServingFundsFallback(page, pageSize);
      if (servingFallback.items.length > 0) {
        return NextResponse.json(servingFallback, {
          status: 200,
          headers: {
            "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
            "X-Funds-Cache": "serving-fast",
            "X-Funds-Source": "serving",
            "X-Funds-Degraded": classified.category,
            "X-Db-Failure-Class": classified.category,
            ...servingHeaders({
              world: servingWorld,
              trust: {
                trustAsFinal: false,
                degradedKind: "legacy_fallback",
                degradedReason: classified.category,
              },
              routeSource: "legacy_fallback",
              fallbackUsed: true,
            }),
            ...dbHeaders,
          },
        });
      }
      const scoresFallback = await buildScoresCacheFundsFallback({
        page,
        pageSize,
        q,
        category,
        fundType,
        sortField,
        sortDir,
      });
      if (scoresFallback.items.length > 0) {
        return NextResponse.json(scoresFallback, {
          status: 200,
          headers: {
            "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
            "X-Funds-Cache": "scores-cache-fast",
            "X-Funds-Source": "scores-cache",
            "X-Funds-Degraded": classified.category,
            "X-Db-Failure-Class": classified.category,
            ...dbHeaders,
          },
        });
      }
      console.warn(
        `[api/funds][fast-degrade] class=${classified.category} timeout=${isFundsTimeoutError(e) ? 1 : 0} ms=${
          Date.now() - startedAt
        }`
      );
      return NextResponse.json(
        { items: [], page, pageSize, total: 0, totalPages: 1 } satisfies FundsPayload,
        {
          status: 200,
          headers: {
            "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
            "X-Funds-Cache": "empty-fast",
            "X-Funds-Source": "empty",
            "X-Funds-Degraded": classified.category,
            "X-Db-Failure-Class": classified.category,
            ...dbHeaders,
          },
        }
      );
    }

    console.error("[db-route-failure]", {
      route: "/api/funds",
      failureClass: classified.category,
      envConfigured: dbEnvStatus.configured,
      dbEnvStatus: dbEnvStatus.failureCategory ?? "ok",
      connectionMode: dbEnvStatus.connectionMode,
      prismaCode: classified.prismaCode,
      retryable: classified.retryable,
      message: sanitizeFailureDetail(classified.message),
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
    const fallback = await buildServingFundsFallback(page, pageSize);
    if (fallback.items.length === 0) {
      const scoresFallback = await buildScoresCacheFundsFallback({
        page,
        pageSize,
        q,
        category,
        fundType,
        sortField,
        sortDir,
      });
      if (scoresFallback.items.length > 0) {
        return NextResponse.json(scoresFallback, {
          status: 200,
          headers: {
            "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
            "X-Funds-Cache": "scores-cache-fallback",
            "X-Funds-Source": "scores-cache",
            "X-Funds-Degraded": classified.category,
            "X-Db-Failure-Class": classified.category,
            ...dbHeaders,
          },
        });
      }
    }
    return NextResponse.json(fallback, {
      status: 200,
      headers: {
        "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
        "X-Funds-Cache": fallback.items.length > 0 ? "serving-fallback" : "empty",
        "X-Funds-Source": fallback.items.length > 0 ? "serving" : "empty",
        "X-Db-Failure-Class": classified.category,
        ...servingHeaders({
          world: servingWorld,
          trust: {
            trustAsFinal: false,
            degradedKind: "legacy_fallback",
            degradedReason: classified.category,
          },
          routeSource: "legacy_fallback",
          fallbackUsed: true,
        }),
        ...dbHeaders,
      },
    });
  }
}

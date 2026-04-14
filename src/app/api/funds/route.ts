import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import { getFundsPage, type FundListSortField } from "@/lib/services/fund-list.service";
import { prisma } from "@/lib/prisma";
import { classifyDatabaseError } from "@/lib/database-error-classifier";
import { listFundDetailCoreServingRows } from "@/lib/services/fund-detail-core-serving.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PAGE = 200;
const MAX_PAGE_SIZE = 100;
const MAX_QUERY_LENGTH = 64;
const MAX_FILTER_LENGTH = 32;
const FUNDS_TIMEOUT_MS = parseEnvMs("FUNDS_ROUTE_TIMEOUT_MS", 5_000, 2_500, 20_000);
const FUNDS_CACHE_TTL_MS = parseEnvMs("FUNDS_ROUTE_CACHE_TTL_MS", 90_000, 10_000, 10 * 60_000);
const FUNDS_STALE_TTL_MS = parseEnvMs("FUNDS_ROUTE_STALE_TTL_MS", 10 * 60_000, 30_000, 60 * 60_000);
const FUNDS_LIGHT_LATEST_TIMEOUT_MS = parseEnvMs("FUNDS_LIGHT_LATEST_TIMEOUT_MS", 1_000, 400, 6_000);
const FUNDS_LIGHT_ROWS_TIMEOUT_MS = parseEnvMs("FUNDS_LIGHT_ROWS_TIMEOUT_MS", 1_200, 500, 6_000);
const FUNDS_LIGHT_SERVING_LIMIT = parseEnvMs("FUNDS_LIGHT_SERVING_LIMIT", 180, 30, 320);

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

async function buildLightFundsFallback(page: number, pageSize: number): Promise<FundsPayload> {
  const latest = await withTimeout(
    prisma.fundDailySnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    FUNDS_LIGHT_LATEST_TIMEOUT_MS
  ).catch(() => null);

  if (!latest) {
    return { items: [], page, pageSize, total: 0, totalPages: 1 };
  }

  const rows =
    (await withTimeout(
      prisma.fundDailySnapshot.findMany({
        where: { date: latest.date },
        orderBy: [{ portfolioSize: "desc" }, { code: "asc" }],
        take: Math.max(1, Math.min(pageSize, 20)),
        select: {
          fundId: true,
          code: true,
          name: true,
          shortName: true,
          logoUrl: true,
          portfolioSize: true,
          lastPrice: true,
          dailyReturn: true,
          monthlyReturn: true,
          yearlyReturn: true,
          investorCount: true,
          categoryCode: true,
          categoryName: true,
          fundTypeCode: true,
          fundTypeName: true,
        },
      }),
      FUNDS_LIGHT_ROWS_TIMEOUT_MS
    ).catch(() => [])) ?? [];

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
    total: rows.length,
    totalPages: 1,
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

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
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
    const lightMode = searchParams.get("light") === "1";
    const state = getFundsRouteState();
    const cached = state.cache.get(cacheKey);
    if (cached && Date.now() - cached.updatedAt <= FUNDS_CACHE_TTL_MS) {
      return NextResponse.json(cached.payload, {
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
          "X-Funds-Cache": "hit",
        },
      });
    }

    if (lightMode) {
      const lightPayload = await buildLightFundsFallback(page, pageSize);
      if (lightPayload.items.length > 0) {
        state.cache.set(cacheKey, { payload: lightPayload, updatedAt: Date.now() });
        return NextResponse.json(lightPayload, {
          headers: {
            "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
            "X-Funds-Cache": "light",
          },
        });
      }
      const servingPayload = await buildServingFundsFallback(page, pageSize);
      return NextResponse.json(servingPayload, {
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
          "X-Funds-Cache": servingPayload.items.length > 0 ? "serving-light" : "empty",
        },
      });
    }

    const result = await withTimeout(
      getFundsPage({
        page,
        pageSize,
        q,
        category,
        fundType,
        sortField,
        sortDir,
      }),
      FUNDS_TIMEOUT_MS
    );

    const payload: FundsPayload = {
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
    };
    state.cache.set(cacheKey, { payload, updatedAt: Date.now() });

    return NextResponse.json(
      payload,
      {
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
          "X-Funds-Cache": "miss",
        },
      }
    );
  } catch (e) {
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
    if (stale && Date.now() - stale.updatedAt <= FUNDS_STALE_TTL_MS) {
      return NextResponse.json(stale.payload, {
        status: 200,
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
          "X-Funds-Cache": "stale",
        },
      });
    }

    const classified = classifyDatabaseError(e);
    if (isFundsTimeoutError(e) || shouldFastDegradeForDb(classified.category)) {
      const fastLightFallback = await buildLightFundsFallback(page, pageSize);
      if (fastLightFallback.items.length > 0) {
        return NextResponse.json(fastLightFallback, {
          status: 200,
          headers: {
            "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
            "X-Funds-Cache": "light-fast",
            "X-Funds-Degraded": classified.category,
          },
        });
      }
      const servingFallback = await buildServingFundsFallback(page, pageSize);
      if (servingFallback.items.length > 0) {
        return NextResponse.json(servingFallback, {
          status: 200,
          headers: {
            "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
            "X-Funds-Cache": "serving-fast",
            "X-Funds-Degraded": classified.category,
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
            "X-Funds-Degraded": classified.category,
          },
        }
      );
    }

    console.error("[api/funds]", e, `ms=${Date.now() - startedAt}`);
    const fallback = await buildLightFundsFallback(page, pageSize);
    return NextResponse.json(fallback, {
      status: 200,
      headers: {
        "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
        "X-Funds-Cache": fallback.items.length > 0 ? "light-fallback" : "empty",
      },
    });
  }
}

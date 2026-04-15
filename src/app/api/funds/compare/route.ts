import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import { prisma } from "@/lib/prisma";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import { fundTypeForApi } from "@/lib/fund-type-display";
import { getFundDetailCoreServingCached } from "@/lib/services/fund-detail-core-serving.service";
import {
  loadCompareContext,
  type CompareContextDto,
} from "@/lib/services/compare-reference.service";
import { readServingPayloadForCompareSeries } from "@/lib/services/compare-series-resolution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX = 4;
const CODE_RE = /^[A-Z0-9]{2,12}$/;
const COMPARE_DB_TIMEOUT_MS = Number(process.env.COMPARE_ROUTE_DB_TIMEOUT_MS ?? "2500");
const COMPARE_CONTEXT_TIMEOUT_MS = Number(process.env.COMPARE_ROUTE_CONTEXT_TIMEOUT_MS ?? "3000");
const COMPARE_SERVING_READ_TIMEOUT_MS = Number(process.env.COMPARE_ROUTE_SERVING_READ_TIMEOUT_MS ?? "4200");

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
  const reads = await Promise.all(
    codes.map(async (code) => {
      try {
        return await withTimeout(
          readServingPayloadForCompareSeries(code, getFundDetailCoreServingCached),
          COMPARE_SERVING_READ_TIMEOUT_MS,
          "compare_serving_read"
        );
      } catch {
        return { payload: null };
      }
    })
  );
  return reads
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
  try {
    const codes = parseCodes(req.nextUrl.searchParams.get("codes"));
    if (codes.length === 0) {
      return NextResponse.json(
        {
          funds: [] as const,
          compare: null as CompareContextDto | null,
        },
        {
          headers: { "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC) },
        }
      );
    }

    let rows = await loadRowsFromSnapshot(codes).catch(() => []);
    let degradedSource: string | null = null;
    if (rows.length === 0) {
      rows = await loadRowsFromServing(codes).catch(() => []);
      if (rows.length > 0) degradedSource = "serving";
    }

    const activeRows = rows.filter((row) => row.isActive);
    const byCode = new Map(activeRows.map((row) => [row.code.trim().toUpperCase(), row]));
    const ordered = codes.map((code) => byCode.get(code)).filter(Boolean) as CompareFundRow[];
    const contextOutcome = await loadContextForRows(ordered);
    const compare = contextOutcome.compare;
    const extrasById = contextOutcome.extrasById;
    if (contextOutcome.degraded && !degradedSource) degradedSource = "context_fallback";

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

    return NextResponse.json(
      { funds, compare },
      {
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
          ...(degradedSource ? { "X-Compare-Degraded-Source": degradedSource } : {}),
          ...(contextOutcome.failureClass ? { "X-Compare-Failure-Class": contextOutcome.failureClass } : {}),
        },
      }
    );
  } catch (e) {
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
      return NextResponse.json(
        {
          funds: fallbackFunds,
          compare: buildDegradedCompareContext(ordered.map((row) => row.code.trim().toUpperCase())),
        },
        {
          headers: {
            "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
            "X-Compare-Degraded-Source": "serving_exception_fallback",
            "X-Compare-Failure-Class": isTimeoutLike(e) ? "timeout" : "compare_failed",
          },
        }
      );
    }
    if (process.env.NODE_ENV !== "production") {
      console.error("[funds/compare]", e);
    }
    return NextResponse.json({ error: "compare_failed" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import { prisma } from "@/lib/prisma";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import { fundTypeForApi } from "@/lib/fund-type-display";
import {
  loadCompareContext,
  type CompareContextDto,
} from "@/lib/services/compare-reference.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX = 4;
const CODE_RE = /^[A-Z0-9]{2,12}$/;

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

    const latest = await prisma.fundDailySnapshot.findFirst({
      orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
      select: { date: true },
    });
    if (!latest) {
      return NextResponse.json(
        { funds: [] as const, compare: null as CompareContextDto | null },
        {
          headers: { "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC) },
        }
      );
    }

    const rows = await prisma.fundDailySnapshot.findMany({
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
    });

    const activeRows = rows.filter((row) => row.fund.isActive);
    const byCode = new Map(activeRows.map((r) => [r.code.trim().toUpperCase(), r]));
    const ordered = codes.map((c) => byCode.get(c)).filter(Boolean) as typeof activeRows;

    const internal = ordered.map((it) => ({
      id: it.fundId,
      code: it.code,
      name: it.name,
      shortName: it.shortName,
      categoryId: it.fund.categoryId,
      categoryCode: it.categoryCode ?? null,
      fundTypeCode: it.fundTypeCode ?? null,
      fundTypeName: it.fundTypeName ?? null,
    }));

    const built = internal.length > 0 ? await loadCompareContext(internal) : null;
    const compare = built?.context ?? null;
    const extrasById = built?.extrasByFundId ?? {};

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
        logoUrl: getFundLogoUrlForUi(it.fundId, it.code, it.logoUrl ?? it.fund.logoUrl, it.name),
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
      { headers: { "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC) } }
    );
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[funds/compare]", e);
    }
    return NextResponse.json({ error: "compare_failed" }, { status: 500 });
  }
}

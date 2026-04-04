import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SORT_MAP: Record<string, Prisma.FundScalarFieldEnum> = {
  marketCap: "portfolioSize",
  changePercent: "dailyReturn",
  volume: "investorCount",
  lastPrice: "lastPrice",
  turnover: "portfolioSize",
};

/**
 * Geriye dönük uyumluluk: `/api/stocks` istekleri fon listesine yönlendirilir.
 * `sector` → kategori kodu, `index` → fon türü kodu (0, 1).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "50")));
    const q = (searchParams.get("q") ?? "").trim();
    const sector = searchParams.get("sector") ?? undefined;
    const indexCode = searchParams.get("index") ?? undefined;
    const sort = searchParams.get("sort") ?? "marketCap:desc";
    const [rawField, sortDir] = sort.split(":") as [string, "asc" | "desc"];
    const sortField = SORT_MAP[rawField] ?? "portfolioSize";

    const where: Prisma.FundWhereInput = { isActive: true };
    if (q) {
      where.OR = [
        { code: { contains: q.toUpperCase() } },
        { name: { contains: q } },
        { shortName: { contains: q } },
      ];
    }
    if (sector) where.category = { code: sector };
    if (indexCode !== undefined && indexCode !== "") {
      const c = parseInt(indexCode, 10);
      if (!Number.isNaN(c)) where.fundType = { code: c };
    }

    const [items, total] = await Promise.all([
      prisma.fund.findMany({
        where,
        orderBy: { [sortField]: sortDir === "asc" ? "asc" : "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          code: true,
          name: true,
          shortName: true,
          logoUrl: true,
          portfolioSize: true,
          lastPrice: true,
          dailyReturn: true,
          investorCount: true,
          category: { select: { code: true, name: true, color: true } },
        },
      }),
      prisma.fund.count({ where }),
    ]);

    const legacy = items.map((f) => {
      const r = f.dailyReturn / 100;
      const derivedPrev =
        f.dailyReturn !== 0 &&
        Number.isFinite(f.dailyReturn) &&
        Math.abs(f.dailyReturn) < 99.9 &&
        f.lastPrice > 0
          ? f.lastPrice / (1 + r)
          : null;
      return {
        id: f.id,
        symbol: f.code,
        name: f.name,
        shortName: f.shortName,
        logoUrl: f.logoUrl,
        marketCap: f.portfolioSize,
        lastPrice: f.lastPrice,
        previousClose: null as number | null,
        change: derivedPrev != null ? f.lastPrice - derivedPrev : 0,
        changePercent: f.dailyReturn,
        dayHigh: f.lastPrice,
        dayLow: f.lastPrice,
        volume: f.investorCount,
        turnover: f.portfolioSize,
        peRatio: null as number | null,
        sparkline: [] as number[],
        sparklineTrend:
          f.dailyReturn > 0 ? ("up" as const) : f.dailyReturn < 0 ? ("down" as const) : ("flat" as const),
        sector: f.category
          ? { code: f.category.code, name: f.category.name, color: f.category.color }
          : null,
      };
    });

    return NextResponse.json({
      items: legacy,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "stocks_legacy_failed" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fundLogoProxyUrlForFundId } from "@/lib/services/fund-logo.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SORT_FIELDS = new Set([
  "portfolioSize",
  "dailyReturn",
  "lastPrice",
  "investorCount",
  "weeklyReturn",
  "monthlyReturn",
  "yearlyReturn",
]);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "50")));
    const q = (searchParams.get("q") ?? "").trim();
    const category = searchParams.get("category") ?? undefined;
    const fundType = searchParams.get("fundType") ?? undefined;
    const sort = searchParams.get("sort") ?? "portfolioSize:desc";
    const [rawField, sortDir] = sort.split(":") as [string, "asc" | "desc"];
    const sortField = SORT_FIELDS.has(rawField) ? rawField : "portfolioSize";

    const where: Prisma.FundWhereInput = { isActive: true };
    if (q) {
      where.OR = [
        { code: { contains: q.toUpperCase() } },
        { name: { contains: q } },
        { shortName: { contains: q } },
      ];
    }
    if (category) where.category = { code: category };
    if (fundType) {
      const c = parseInt(fundType, 10);
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
          investorCount: true,
          shareCount: true,
          lastPrice: true,
          previousPrice: true,
          dailyReturn: true,
          weeklyReturn: true,
          monthlyReturn: true,
          yearlyReturn: true,
          category: { select: { code: true, name: true, color: true } },
          fundType: { select: { code: true, name: true } },
        },
      }),
      prisma.fund.count({ where }),
    ]);

    const itemsOut = items.map((it) => ({
      ...it,
      logoUrl: fundLogoProxyUrlForFundId(it.id, it.logoUrl, it.name),
      sparkline: [] as number[],
      sparklineTrend:
        it.dailyReturn > 0 ? "up" : it.dailyReturn < 0 ? ("down" as const) : ("flat" as const),
    }));

    return NextResponse.json({
      items: itemsOut,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "funds_failed" }, { status: 500 });
  }
}

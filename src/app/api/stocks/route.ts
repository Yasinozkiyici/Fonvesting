import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchBistSparklines } from "@/lib/services/yahoo-finance.service";
import { syncYahooStocksIfStale } from "@/lib/services/yahoo-sync.service";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  await syncYahooStocksIfStale({ force: searchParams.get("refresh") === "1" });

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? "100")));
  const q = (searchParams.get("q") ?? "").trim();
  const sector = searchParams.get("sector") ?? undefined;
  const indexCode = searchParams.get("index") ?? undefined;
  const sort = searchParams.get("sort") ?? "marketCap:desc";
  const [sortField, sortDir] = sort.split(":") as [string, "asc" | "desc"];

  const where: any = {
    isActive: true,
  };

  if (q) {
    where.OR = [
      { symbol: { contains: q.toUpperCase() } },
      { name: { contains: q } },
      { shortName: { contains: q } },
    ];
  }

  if (sector) {
    where.sector = { code: sector };
  }

  if (indexCode) {
    where.indices = {
      some: {
        index: { code: indexCode },
      },
    };
  }

  const [items, total] = await Promise.all([
    prisma.stock.findMany({
      where,
      orderBy: { [sortField || "marketCap"]: sortDir === "asc" ? "asc" : "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        symbol: true,
        name: true,
        shortName: true,
        logoUrl: true,
        marketCap: true,
        lastPrice: true,
        previousClose: true,
        change: true,
        changePercent: true,
        dayHigh: true,
        dayLow: true,
        volume: true,
        turnover: true,
        week52High: true,
        week52Low: true,
        peRatio: true,
        sector: {
          select: {
            code: true,
            name: true,
            color: true,
          },
        },
      },
    }),
    prisma.stock.count({ where }),
  ]);

  const sparklines = await fetchBistSparklines(items.map((item) => item.symbol));
  const itemsWithSparklines = items.map((item) => ({
    ...item,
    sparkline: sparklines[item.symbol]?.points ?? [],
    sparklineTrend: sparklines[item.symbol]?.trend ?? "flat",
  }));

  return NextResponse.json(
    {
      items: itemsWithSparklines,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
    {
      headers: {
        "Cache-Control": "s-maxage=30, stale-while-revalidate=60",
      },
    }
  );
}

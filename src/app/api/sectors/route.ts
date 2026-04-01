import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncYahooStocksIfStale } from "@/lib/services/yahoo-sync.service";

export async function GET() {
  await syncYahooStocksIfStale();

  const [sectors, sectorStats] = await Promise.all([
    prisma.sector.findMany({
      include: {
        _count: {
          select: { stocks: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.stock.groupBy({
      by: ["sectorId"],
      where: { isActive: true, sectorId: { not: null } },
      _sum: { marketCap: true },
      _avg: { changePercent: true },
      _count: { _all: true },
    }),
  ]);

  const statsBySectorId = new Map(
    sectorStats
      .filter((s) => s.sectorId)
      .map((s) => [
        s.sectorId as string,
        {
          totalMarketCap: s._sum.marketCap ?? 0,
          avgChange: s._avg.changePercent ?? 0,
          stockCount: s._count._all ?? 0,
        },
      ])
  );

  const sectorsWithStats = sectors.map((sector) => {
    const stats = statsBySectorId.get(sector.id);
    return {
      ...sector,
      stockCount: stats?.stockCount ?? sector._count.stocks,
      totalMarketCap: stats?.totalMarketCap ?? 0,
      avgChange: parseFloat((stats?.avgChange ?? 0).toFixed(2)),
    };
  });

  return NextResponse.json(sectorsWithStats, {
    headers: {
      "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
    },
  });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function formatNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000)
    return (n / 1_000_000_000_000).toFixed(2) + " Trilyon";
  if (abs >= 1_000_000_000)
    return (n / 1_000_000_000).toFixed(2) + " Milyar";
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + " Milyon";
  if (abs >= 1_000) return (n / 1_000).toFixed(2) + " Bin";
  return n.toFixed(2);
}

function formatTL(n: number): string {
  return "₺" + formatNumber(n);
}

export async function GET() {
  try {

    const [stocks, snapshot, bist100] = await Promise.all([
      prisma.stock.findMany({
        where: { isActive: true },
        select: {
          marketCap: true,
          volume: true,
          turnover: true,
          changePercent: true,
        },
      }),
      prisma.marketSnapshot.findFirst({
        orderBy: { date: "desc" },
      }),
      prisma.index.findUnique({
        where: { code: "XU100" },
      }),
    ]);

    const totalMarketCap = stocks.reduce((sum, s) => sum + s.marketCap, 0);
    const totalVolume = stocks.reduce((sum, s) => sum + s.volume, 0);
    const totalTurnover = stocks.reduce((sum, s) => sum + s.turnover, 0);
    const advancers = stocks.filter((s) => s.changePercent > 0).length;
    const decliners = stocks.filter((s) => s.changePercent < 0).length;
    const unchanged = stocks.filter((s) => s.changePercent === 0).length;

    const topGainers = await prisma.stock.findMany({
      where: { isActive: true },
      orderBy: { changePercent: "desc" },
      take: 5,
      select: {
        symbol: true,
        name: true,
        shortName: true,
        lastPrice: true,
        changePercent: true,
      },
    });

    const topLosers = await prisma.stock.findMany({
      where: { isActive: true },
      orderBy: { changePercent: "asc" },
      take: 5,
      select: {
        symbol: true,
        name: true,
        shortName: true,
        lastPrice: true,
        changePercent: true,
      },
    });

    const mostActive = await prisma.stock.findMany({
      where: { isActive: true },
      orderBy: { turnover: "desc" },
      take: 5,
      select: {
        symbol: true,
        name: true,
        shortName: true,
        lastPrice: true,
        turnover: true,
        changePercent: true,
      },
    });

    const payload = {
      bist100: bist100
        ? {
            value: bist100.lastValue,
            change: bist100.change,
            changePercent: bist100.changePercent,
          }
        : null,
      totalMarketCap,
      totalVolume,
      totalTurnover,
      stockCount: stocks.length,
      advancers,
      decliners,
      unchanged,
      usdTry: snapshot?.usdTry ?? null,
      eurTry: snapshot?.eurTry ?? null,
      topGainers,
      topLosers,
      mostActive,
      formatted: {
        totalMarketCap: formatTL(totalMarketCap),
        totalTurnover: formatTL(totalTurnover),
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (e) {
    console.error("Market API error:", e);
    return NextResponse.json({ error: "market_failed" }, { status: 500 });
  }
}

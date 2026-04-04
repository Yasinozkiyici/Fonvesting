import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function formatNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return (n / 1_000_000_000_000).toFixed(2) + " Trilyon";
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + " Milyar";
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + " Milyon";
  if (abs >= 1_000) return (n / 1_000).toFixed(2) + " Bin";
  return n.toFixed(2);
}

function formatTL(n: number): string {
  return "₺" + formatNumber(n);
}

export async function GET() {
  try {
    const [
      fundCount,
      sums,
      nonZeroReturnAvg,
      advancers,
      decliners,
      snapshot,
      topGainers,
      topLosers,
    ] = await Promise.all([
      prisma.fund.count({ where: { isActive: true } }),
      prisma.fund.aggregate({
        where: { isActive: true },
        _sum: { portfolioSize: true, investorCount: true },
      }),
      prisma.fund.aggregate({
        where: { isActive: true, dailyReturn: { not: 0 } },
        _avg: { dailyReturn: true },
      }),
      prisma.fund.count({ where: { isActive: true, dailyReturn: { gt: 0 } } }),
      prisma.fund.count({ where: { isActive: true, dailyReturn: { lt: 0 } } }),
      prisma.marketSnapshot.findFirst({
        orderBy: { date: "desc" },
      }),
      prisma.fund.findMany({
        where: { isActive: true },
        orderBy: { dailyReturn: "desc" },
        take: 5,
        select: {
          code: true,
          name: true,
          shortName: true,
          lastPrice: true,
          dailyReturn: true,
          portfolioSize: true,
        },
      }),
      prisma.fund.findMany({
        where: { isActive: true },
        orderBy: { dailyReturn: "asc" },
        take: 5,
        select: {
          code: true,
          name: true,
          shortName: true,
          lastPrice: true,
          dailyReturn: true,
          portfolioSize: true,
        },
      }),
    ]);

    const totalPortfolioSize = sums._sum.portfolioSize ?? 0;
    const totalInvestorCount = sums._sum.investorCount ?? 0;
    const unchanged = Math.max(0, fundCount - advancers - decliners);
    const avgDailyReturn = nonZeroReturnAvg._avg.dailyReturn ?? 0;

    return NextResponse.json({
      summary: { avgDailyReturn, totalFundCount: fundCount },
      totalPortfolioSize,
      totalInvestorCount,
      fundCount,
      advancers,
      decliners,
      unchanged,
      usdTry: snapshot?.usdTry ?? null,
      eurTry: snapshot?.eurTry ?? null,
      topGainers,
      topLosers,
      formatted: {
        totalPortfolioSize: formatTL(totalPortfolioSize),
        totalInvestorCount: totalInvestorCount.toLocaleString("tr-TR"),
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "market_failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const types = await prisma.fundType.findMany({
      orderBy: { code: "asc" },
      include: { _count: { select: { funds: true } } },
    });

    const out = await Promise.all(
      types.map(async (t) => {
        const agg = await prisma.fund.aggregate({
          where: { fundTypeId: t.id, isActive: true },
          _avg: { dailyReturn: true },
          _sum: { portfolioSize: true },
        });
        return {
          id: t.id,
          code: t.code,
          name: t.name,
          description: t.description,
          fundCount: t._count.funds,
          avgDailyReturn: agg._avg.dailyReturn ?? 0,
          totalPortfolioSize: agg._sum.portfolioSize ?? 0,
        };
      })
    );

    return NextResponse.json(out);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "fund_types_failed" }, { status: 500 });
  }
}

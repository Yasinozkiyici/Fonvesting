import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fundTypeDisplayLabel } from "@/lib/fund-type-display";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Geriye dönük uyumluluk: endeks kartları artık fon türleridir (0=YF, 1=BES). */
export async function GET() {
  try {
    const types = await prisma.fundType.findMany({
      orderBy: { code: "asc" },
      include: { _count: { select: { funds: true } } },
    });

    const payload = await Promise.all(
      types.map(async (t) => {
        const agg = await prisma.fund.aggregate({
          where: { fundTypeId: t.id, isActive: true },
          _avg: { dailyReturn: true },
          _sum: { portfolioSize: true },
        });
        return {
          code: String(t.code),
          name: fundTypeDisplayLabel(t),
          changePercent: Number((agg._avg.dailyReturn ?? 0).toFixed(4)),
          value: agg._sum.portfolioSize ?? 0,
          stockCount: t._count.funds,
        };
      })
    );

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=900" },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "indices_failed" }, { status: 500 });
  }
}

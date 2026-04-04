import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Geriye dönük uyumluluk: sektör listesi artık TEFAS kategorileridir. */
export async function GET() {
  try {
    const categories = await prisma.fundCategory.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { funds: true } } },
    });

    const rows = await Promise.all(
      categories.map(async (c) => {
        const agg = await prisma.fund.aggregate({
          where: { categoryId: c.id, isActive: true },
          _avg: { dailyReturn: true },
        });
        return {
          id: c.id,
          code: c.code,
          name: c.name,
          color: c.color,
          stockCount: c._count.funds,
          avgChange: Number((agg._avg.dailyReturn ?? 0).toFixed(4)),
        };
      })
    );

    return NextResponse.json(rows, {
      headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "sectors_failed" }, { status: 500 });
  }
}

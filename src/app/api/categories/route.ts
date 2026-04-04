import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const [categories, byCategory] = await Promise.all([
      prisma.fundCategory.findMany({
        orderBy: { name: "asc" },
      }),
      prisma.fund.groupBy({
        by: ["categoryId"],
        where: { isActive: true },
        _count: { _all: true },
        _avg: { dailyReturn: true },
        _sum: { portfolioSize: true },
      }),
    ]);

    const stats = new Map(
      byCategory
        .filter((row): row is typeof row & { categoryId: string } => row.categoryId != null)
        .map((row) => [
          row.categoryId,
          {
            fundCount: row._count._all,
            avgDailyReturn: Number((row._avg.dailyReturn ?? 0).toFixed(4)),
            totalPortfolioSize: row._sum.portfolioSize ?? 0,
          },
        ])
    );

    const out = categories.map((c) => {
      const s = stats.get(c.id);
      return {
        id: c.id,
        code: c.code,
        name: c.name,
        color: c.color,
        description: c.description,
        fundCount: s?.fundCount ?? 0,
        avgDailyReturn: s?.avgDailyReturn ?? 0,
        totalPortfolioSize: s?.totalPortfolioSize ?? 0,
      };
    });

    return NextResponse.json(out);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "categories_failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const indices = await prisma.index.findMany({
    where: { code: { in: ["XU100", "XU030"] } },
    orderBy: { code: "asc" },
    include: {
      _count: {
        select: { stocks: true },
      },
    },
  });

  const payload = indices.map((index) => ({
    code: index.code,
    name: index.name,
    changePercent: index.changePercent,
    value: index.lastValue,
    stockCount: index._count.stocks,
  }));

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "s-maxage=300, stale-while-revalidate=900",
    },
  });
}

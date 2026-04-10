import { NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import { getCategorySummariesFromDailySnapshot } from "@/lib/services/fund-daily-snapshot.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = (await getCategorySummariesFromDailySnapshot()).map((category) => ({
      id: category.id,
      code: category.code,
      name: category.name,
      color: category.color,
      stockCount: category.fundCount,
      avgChange: category.avgDailyReturn,
    }));

    return NextResponse.json(rows, {
      headers: { "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC) },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "sectors_failed" }, { status: 500 });
  }
}

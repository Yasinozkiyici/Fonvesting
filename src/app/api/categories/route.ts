import { NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import { getCategorySummariesFromDailySnapshot } from "@/lib/services/fund-daily-snapshot.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const out = await getCategorySummariesFromDailySnapshot();
    return NextResponse.json(out, {
      headers: {
        "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "categories_failed" }, { status: 500 });
  }
}

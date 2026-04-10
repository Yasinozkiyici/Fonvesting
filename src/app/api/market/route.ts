import { NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import { getMarketSummaryFromDailySnapshot } from "@/lib/services/fund-daily-snapshot.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = ["fra1"];

export async function GET() {
  try {
    const payload = await getMarketSummaryFromDailySnapshot();
    if (!payload) {
      return NextResponse.json({ error: "market_empty" }, { status: 404 });
    }
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "market_failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import { getFundTypeSummariesFromDailySnapshot } from "@/lib/services/fund-daily-snapshot.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getFundTypeSummariesFromDailySnapshot(), {
      headers: {
        "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "fund_types_failed" }, { status: 500 });
  }
}

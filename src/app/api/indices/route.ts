import { NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import { getFundTypeSummariesFromDailySnapshot } from "@/lib/services/fund-daily-snapshot.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = (await getFundTypeSummariesFromDailySnapshot()).map((fundType) => ({
      code: String(fundType.code),
      name: fundType.name,
      changePercent: fundType.avgDailyReturn,
      value: fundType.totalPortfolioSize,
      stockCount: fundType.fundCount,
    }));

    return NextResponse.json(payload, {
      headers: { "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC) },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "indices_failed" }, { status: 500 });
  }
}

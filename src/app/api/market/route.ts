import { NextResponse } from "next/server";
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
        "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
      },
    });
  } catch (e) {
    console.error("[api/market]", e);
    const devDetail = process.env.NODE_ENV !== "production" && e instanceof Error ? e.message : undefined;
    return NextResponse.json(
      { error: "market_failed", ...(devDetail ? { detail: devDetail } : {}) },
      { status: 500 }
    );
  }
}

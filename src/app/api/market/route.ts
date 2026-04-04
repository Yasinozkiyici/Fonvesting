import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getMarketSummaryFromDailySnapshot } from "@/lib/services/fund-daily-snapshot.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Piyasa özeti sık değişmez; kısa önbellek tekrar istekleri ve soğuk DB yükünü azaltır. */
/** Veri günde bir kez güncelleniyor; CDN/process önbelleği 24 saat. */
const CACHE_SEC = 86_400;

async function computeMarketPayload() {
  return getMarketSummaryFromDailySnapshot();
}

const getCachedMarket = unstable_cache(computeMarketPayload, ["api-market-v1"], {
  revalidate: CACHE_SEC,
});

export async function GET() {
  try {
    const payload = await getCachedMarket();
    if (!payload) {
      return NextResponse.json({ error: "market_empty" }, { status: 404 });
    }
    return NextResponse.json(payload);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "market_failed" }, { status: 500 });
  }
}

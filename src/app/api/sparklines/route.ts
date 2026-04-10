import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import { fetchBistSparklines } from "@/lib/services/yahoo-finance.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseSymbols(req: NextRequest): string[] {
  const raw = (req.nextUrl.searchParams.get("symbols") ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase().slice(0, 12))
    .filter((value) => /^[A-Z0-9._-]+$/.test(value));
}

export async function GET(req: NextRequest) {
  const symbols = parseSymbols(req);
  const limit = Math.min(50, symbols.length);
  const limited = symbols.slice(0, limit);

  if (limited.length === 0) {
    return NextResponse.json({ ok: true, items: {} });
  }

  try {
    const items = await fetchBistSparklines(limited);
    return NextResponse.json(
      { ok: true, items },
      {
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
        },
      }
    );
  } catch (error) {
    console.error("[api/sparklines] failed:", error);
    return NextResponse.json({ ok: false, items: {} }, { status: 200 });
  }
}

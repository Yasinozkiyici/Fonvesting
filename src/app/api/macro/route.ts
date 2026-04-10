import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl, readMacroDataVersion } from "@/lib/data-freshness";
import { getMacroSeriesData } from "@/lib/services/macro-series.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CODES = 10;
const DEFAULT_DAYS = 730;
const MAX_DAYS = 3650;
const DEFAULT_POINT_LIMIT = 400;
const MAX_POINT_LIMIT = 800;

function parsePositiveInt(raw: string | null, fallback: number, max: number): number {
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function parseBooleanFlag(raw: string | null): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const codes = (searchParams.get("codes") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, MAX_CODES);
    const includePoints = parseBooleanFlag(searchParams.get("includePoints"));
    const days = parsePositiveInt(searchParams.get("days"), DEFAULT_DAYS, MAX_DAYS);
    const pointLimit = parsePositiveInt(searchParams.get("pointLimit"), DEFAULT_POINT_LIMIT, MAX_POINT_LIMIT);

    const version = await readMacroDataVersion();
    const getCachedMacro = unstable_cache(
      async () => getMacroSeriesData({ codes, days, includePoints, pointLimit }),
      ["api-macro-v2", codes.join(","), String(days), String(includePoints), String(pointLimit), version],
      { revalidate: LIVE_DATA_CACHE_SEC }
    );
    const payload = await getCachedMacro();
    return NextResponse.json(payload, {
      headers: { "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC) },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "macro_failed" }, { status: 500 });
  }
}

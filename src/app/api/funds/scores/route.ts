import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import type { RankingMode } from "@/lib/scoring";
import { getScoresPayloadServerCached } from "@/lib/services/fund-scores-cache.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Önbellek doluysa yanıt çok hızlı; boşsa ilk hesap uzun sürebilir (günlük warm önerilir). */
export const maxDuration = 120;

const MAX_CATEGORY_LENGTH = 32;
const MAX_QUERY_LENGTH = 64;

function normalizeRankingMode(searchParams: URLSearchParams): RankingMode {
  const sortRaw = (searchParams.get("sortMode") ?? "").toLowerCase().replace(/-/g, "");
  if (sortRaw === "lowrisk") return "LOW_RISK";
  if (sortRaw === "highreturn") return "HIGH_RETURN";
  if (sortRaw === "stable") return "STABLE";
  if (sortRaw === "best") return "BEST";

  const mode = searchParams.get("mode") || "BEST";
  if (mode === "LOW_RISK" || mode === "HIGH_RETURN" || mode === "STABLE") return mode;
  return "BEST";
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = normalizeRankingMode(searchParams);
    const categoryCode = (searchParams.get("category") ?? "").trim().slice(0, MAX_CATEGORY_LENGTH);
    const queryTrim = (searchParams.get("q") ?? searchParams.get("query") ?? "").trim().slice(0, MAX_QUERY_LENGTH);

    const payload = await getScoresPayloadServerCached(mode, categoryCode, queryTrim);
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
      },
    });
  } catch (error) {
    console.error("[scores] Error:", error);
    const isProduction = process.env.NODE_ENV === "production";
    const message = isProduction
      ? "scores_failed"
      : error instanceof Error
        ? error.message
        : "Skorlar hesaplanamadı. Veritabanı veya bağlantıyı kontrol edin.";
    return NextResponse.json(
      { error: "scores_failed", message },
      { status: 500 }
    );
  }
}

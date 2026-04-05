import { NextRequest, NextResponse } from "next/server";
import type { RankingMode } from "@/lib/scoring";
import { getScoresPayloadCached } from "@/lib/services/fund-scores-cache.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Önbellek doluysa yanıt çok hızlı; boşsa ilk hesap uzun sürebilir (günlük warm önerilir). */
export const maxDuration = 120;

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
    const categoryCode = searchParams.get("category") ?? "";
    const queryTrim = (searchParams.get("q") ?? searchParams.get("query") ?? "").trim();

    const payload = await getScoresPayloadCached(mode, categoryCode, queryTrim);
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[scores] Error:", error);
    const message =
      error instanceof Error ? error.message : "Skorlar hesaplanamadı. Veritabanı veya bağlantıyı kontrol edin.";
    return NextResponse.json(
      { error: "scores_failed", message },
      { status: 500 }
    );
  }
}

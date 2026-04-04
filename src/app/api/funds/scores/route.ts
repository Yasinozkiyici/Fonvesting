import { NextRequest, NextResponse } from "next/server";
import type { RankingMode } from "@/lib/scoring";
import { getScoresPayloadCached } from "@/lib/services/fund-scores-cache.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Önbellek doluysa yanıt çok hızlı; boşsa ilk hesap uzun sürebilir (günlük warm önerilir). */
export const maxDuration = 120;

function normalizeRankingMode(raw: string): RankingMode {
  if (raw === "LOW_RISK" || raw === "HIGH_RETURN" || raw === "STABLE") return raw;
  return "BEST";
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = normalizeRankingMode(searchParams.get("mode") || "BEST");
    const categoryCode = searchParams.get("category") ?? "";

    const payload = await getScoresPayloadCached(mode, categoryCode);
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

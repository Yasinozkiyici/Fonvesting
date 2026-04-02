import { NextRequest, NextResponse } from "next/server";
import { fetchBistSparklines } from "@/lib/services/yahoo-finance.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseSymbols(req: NextRequest): string[] {
  const raw = (req.nextUrl.searchParams.get("symbols") ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  const symbols = parseSymbols(req);
  const limit = Math.min(20, symbols.length);
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
          "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
        },
      }
    );
  } catch (error) {
    console.error("[api/sparklines] failed:", error);
    return NextResponse.json({ ok: false, items: {} }, { status: 200 });
  }
}


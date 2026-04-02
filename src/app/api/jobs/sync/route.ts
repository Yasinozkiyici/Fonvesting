import { NextRequest, NextResponse } from "next/server";
import { syncYahooStocksIfStale } from "@/lib/services/yahoo-sync.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = req.headers.get("authorization") || "";
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const stats = await syncYahooStocksIfStale({ force: true });
    return NextResponse.json({ ok: true, synced: true, ...stats });
  } catch (error) {
    console.error("[cron-sync] failed:", error);
    return NextResponse.json({ ok: false, error: "sync_failed" }, { status: 500 });
  }
}

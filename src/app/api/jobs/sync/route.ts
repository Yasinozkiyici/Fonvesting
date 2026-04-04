import { NextRequest, NextResponse } from "next/server";
import { runTefasSync } from "@/lib/services/tefas-sync.service";

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
    const result = await runTefasSync({ fundTypeCode: 0 });
    return NextResponse.json({
      ok: result.ok,
      skipped: result.skipped,
      updated: result.updated,
      message: result.message,
    });
  } catch (error) {
    console.error("[cron-sync] TEFAS:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "sync_failed", message }, { status: 500 });
  }
}

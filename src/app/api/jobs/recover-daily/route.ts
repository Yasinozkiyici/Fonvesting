import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/jobs-auth";
import { runDailyRecovery } from "@/lib/services/daily-recovery.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["fra1"];

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDailyRecovery();
    return NextResponse.json(result, { status: result.ok ? 200 : 503 });
  } catch (error) {
    console.error("[cron-recover-daily]", error);
    const message =
      process.env.NODE_ENV === "production"
        ? "recover_daily_failed"
        : error instanceof Error
          ? error.message
          : String(error);
    return NextResponse.json({ ok: false, error: "recover_daily_failed", message }, { status: 500 });
  }
}

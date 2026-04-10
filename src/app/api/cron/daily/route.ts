import { NextRequest, NextResponse } from "next/server";
import { runDailyPipeline } from "@/lib/pipeline/runDailyPipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const authHeader = req.headers.get("authorization")?.trim() ?? "";
  return authHeader === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDailyPipeline();
    return NextResponse.json({ ok: true, pipeline: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "pipeline_failed", message }, { status: 500 });
  }
}

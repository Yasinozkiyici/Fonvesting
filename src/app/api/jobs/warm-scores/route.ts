import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/jobs-auth";
import { runLoggedJob } from "@/lib/job-runs";
import { warmAllScoresApiCaches } from "@/lib/services/fund-scores-cache.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["fra1"];

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const run = await runLoggedJob("warm_scores", () => warmAllScoresApiCaches(), {
      onSuccess: (warm) => ({
        fundsUpdated: warm.written,
        note: "scores_cache_warmed",
      }),
    });
    if (!run.ok) {
      return NextResponse.json({ ok: false, error: "already_running", startedAt: run.startedAt }, { status: 409 });
    }
    const warm = run.result;
    return NextResponse.json({ ok: true, warm });
  } catch (error) {
    console.error("[cron-warm-scores]", error);
    const message =
      process.env.NODE_ENV === "production"
        ? "warm_scores_failed"
        : error instanceof Error
          ? error.message
          : String(error);
    return NextResponse.json({ ok: false, error: "warm_scores_failed", message }, { status: 500 });
  }
}

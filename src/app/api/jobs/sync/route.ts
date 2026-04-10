import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/jobs-auth";
import { runLoggedJob } from "@/lib/job-runs";
import { runDailySourceRefresh } from "@/lib/services/daily-source-refresh.service";
import { runServingRebuild } from "@/lib/services/serving-rebuild.service";
import { warmAllScoresApiCaches } from "@/lib/services/fund-scores-cache.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["fra1"];

type SyncPhase = "all" | "source" | "serving" | "warm";

function resolvePhase(req: NextRequest): SyncPhase {
  const raw = (req.nextUrl.searchParams.get("phase") ?? "all").trim().toLowerCase();
  if (raw === "source" || raw === "serving" || raw === "warm") return raw;
  return "all";
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const phase = resolvePhase(req);

  try {
    if (phase === "source") {
      const run = await runLoggedJob("source_refresh", () => runDailySourceRefresh(), {
        onSuccess: (result) => ({
          fundsUpdated: result.history.writtenRows,
          fundsCreated: result.macro.writtenRows,
          note: result.macro.ok ? null : result.macro.message ?? "macro_partial",
        }),
      });
      if (!run.ok) {
        return NextResponse.json({ ok: false, error: "already_running", phase, startedAt: run.startedAt }, { status: 409 });
      }
      const result = run.result;
      return NextResponse.json({ ok: result.history.ok && result.macro.ok, phase, ...result });
    }

    if (phase === "serving") {
      const run = await runLoggedJob("serving_rebuild", () => runServingRebuild({ warmCaches: false }), {
        onSuccess: (result) => ({
          fundsUpdated: result.serving.written,
          fundsCreated: result.derived.written,
          note: `snapshot=${result.snapshotDate}`,
        }),
      });
      if (!run.ok) {
        return NextResponse.json({ ok: false, error: "already_running", phase, startedAt: run.startedAt }, { status: 409 });
      }
      const result = run.result;
      return NextResponse.json({ ok: true, phase, ...result });
    }

    if (phase === "warm") {
      const run = await runLoggedJob("warm_scores", () => warmAllScoresApiCaches(), {
        onSuccess: (warm) => ({
          fundsUpdated: warm.written,
          note: "scores_cache_warmed",
        }),
      });
      if (!run.ok) {
        return NextResponse.json({ ok: false, error: "already_running", phase, startedAt: run.startedAt }, { status: 409 });
      }
      const warm = run.result;
      return NextResponse.json({ ok: true, phase, warm });
    }

    const run = await runLoggedJob("daily_sync", async () => {
      const source = await runDailySourceRefresh();
      const serving = await runServingRebuild({ warmCaches: false });
      const warm = await warmAllScoresApiCaches();
      return { source, serving, warm };
    }, {
      onSuccess: (result) => ({
        fundsUpdated: result.serving.serving.written,
        fundsCreated: result.warm.written,
        note: `snapshot=${result.serving.snapshotDate}`,
      }),
    });
    if (!run.ok) {
      return NextResponse.json({ ok: false, error: "already_running", phase, startedAt: run.startedAt }, { status: 409 });
    }
    const { source, serving, warm } = run.result;
    return NextResponse.json({
      ok: source.history.ok && source.macro.ok,
      phase,
      source,
      serving,
      warm,
    });
  } catch (error) {
    console.error("[cron-sync]", error);
    const message =
      process.env.NODE_ENV === "production"
        ? "sync_failed"
        : error instanceof Error
          ? error.message
          : String(error);
    return NextResponse.json({ ok: false, error: "sync_failed", phase, message }, { status: 500 });
  }
}

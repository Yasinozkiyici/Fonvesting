import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { isCronAuthorized } from "@/lib/jobs-auth";
import { runLoggedJob } from "@/lib/job-runs";
import { prisma } from "@/lib/prisma";
import { fetchSupabaseRestJson, hasSupabaseRestConfig } from "@/lib/supabase-rest";
import { runDailySourceRefresh } from "@/lib/services/daily-source-refresh.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["fra1"];

function sourceRefreshWorkerConfig():
  | {
      url: string;
      token: string;
    }
  | null {
  const url = process.env.SOURCE_REFRESH_WORKER_WEBHOOK_URL?.trim();
  const token = process.env.SOURCE_REFRESH_WORKER_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

async function dispatchSourceRefreshWorker(triggeredAt: string): Promise<{
  dispatched: boolean;
  status: number;
  body: string;
}> {
  const worker = sourceRefreshWorkerConfig();
  if (!worker) return { dispatched: false, status: 0, body: "worker_not_configured" };

  const response = await fetch(worker.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${worker.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      trigger: "vercel_cron",
      triggeredAt,
      task: "source_refresh",
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`worker_dispatch_failed:${response.status}:${body.slice(0, 300)}`);
  }
  return { dispatched: true, status: response.status, body: body.slice(0, 800) };
}

async function readLatestHistoryStage(): Promise<Record<string, unknown> | null> {
  try {
    const row = await prisma.historySyncState.findUnique({
      where: { key: "tefas_fund_history" },
      select: { details: true },
    });
    if (!row?.details || typeof row.details !== "object" || Array.isArray(row.details)) return null;
    return row.details as Record<string, unknown>;
  } catch {
    if (!hasSupabaseRestConfig()) return null;
    const rows = await fetchSupabaseRestJson<Array<{ details: unknown }>>(
      "HistorySyncState?select=details&key=eq.tefas_fund_history&limit=1",
      { revalidate: 0, timeoutMs: 6000, retries: 0 }
    ).catch(() => []);
    const details = rows[0]?.details;
    if (!details || typeof details !== "object" || Array.isArray(details)) return null;
    return details as Record<string, unknown>;
  }
}

function isSyncLogMissingError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

function isTransientPoolError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("unable to check out connection from the pool") ||
    message.includes("timed out fetching a new connection") ||
    message.includes("too many clients")
  );
}

async function runSourceRefreshDirectWithRetry(attempts = 2) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runDailySourceRefresh();
    } catch (error) {
      lastError = error;
      if (!isTransientPoolError(error) || attempt >= attempts) throw error;
      const waitMs = 1000 * attempt;
      console.warn("[cron-source-refresh] direct refresh transient error; retrying", {
        attempt,
        attempts,
        waitMs,
        message: error instanceof Error ? error.message : String(error),
      });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, waitMs);
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const workerDispatch = await dispatchSourceRefreshWorker(new Date().toISOString());
    if (workerDispatch.dispatched) {
      return NextResponse.json({
        ok: true,
        mode: "worker_dispatch",
        worker: {
          status: workerDispatch.status,
          response: workerDispatch.body,
        },
      });
    }

    let run;
    try {
      run = await runLoggedJob("source_refresh", () => runDailySourceRefresh(), {
        staleMinutes: 5,
        onSuccess: (result) => ({
          fundsUpdated: result.history.writtenRows,
          fundsCreated: result.macro.writtenRows,
          note: result.macro.ok ? null : result.macro.message ?? "macro_partial",
        }),
      });
    } catch (error) {
      if (!isSyncLogMissingError(error) && !isTransientPoolError(error)) throw error;
      const fallback = await runSourceRefreshDirectWithRetry(2);
      return NextResponse.json({
        ok: fallback.history.ok && fallback.macro.ok,
        mode: "direct_fallback",
        history: fallback.history,
        macro: fallback.macro,
      });
    }

    if (!run.ok) {
      const stage = await readLatestHistoryStage().catch(() => null);
      return NextResponse.json(
        { ok: false, error: "already_running", startedAt: run.startedAt, stage },
        { status: 409 }
      );
    }
    const result = run.result;
    const stage = await readLatestHistoryStage().catch(() => null);
    return NextResponse.json({
      ok: result.history.ok && result.macro.ok,
      stage,
      recovery: result.recovery,
      history: result.history,
      macroRecovery: result.macroRecovery,
      macro: result.macro,
    });
  } catch (error) {
    console.error("[cron-source-refresh]", error);
    const stage = await readLatestHistoryStage().catch(() => null);
    const message = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name : "Error";
    const stack = error instanceof Error ? error.stack?.split("\n").slice(0, 3).join("\n") : null;
    return NextResponse.json(
      { ok: false, error: "source_refresh_failed", name, message, stack, stage },
      { status: 500 }
    );
  }
}

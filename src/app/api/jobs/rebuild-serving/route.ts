import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/jobs-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["fra1"];

function servingRebuildWorkerConfig():
  | {
      url: string;
      token: string;
    }
  | null {
  const url = process.env.SERVING_REBUILD_WORKER_WEBHOOK_URL?.trim();
  const token = process.env.SERVING_REBUILD_WORKER_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

async function dispatchServingRebuildWorker(triggeredAt: string): Promise<{
  status: number;
  body: unknown;
}> {
  const worker = servingRebuildWorkerConfig();
  if (!worker) {
    throw new Error("worker_not_configured");
  }

  const response = await fetch(worker.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${worker.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      triggeredAt,
    }),
  });
  const body = await response.json();
  return { status: response.status, body };
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const worker = servingRebuildWorkerConfig();
    if (!worker) {
      return NextResponse.json({ ok: false, error: "worker_not_configured" }, { status: 500 });
    }

    const workerDispatch = await dispatchServingRebuildWorker(new Date().toISOString());
    return NextResponse.json({
      ok: true,
      mode: "worker_dispatch",
      status: workerDispatch.status,
      worker: workerDispatch.body,
    });
  } catch (error) {
    console.error("[cron-rebuild-serving]", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "worker_dispatch_failed", message }, { status: 500 });
  }
}

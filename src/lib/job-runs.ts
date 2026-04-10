import { prisma } from "@/lib/prisma";
import { sendOpsAlert } from "@/lib/ops-alerts";

export type JobSyncType = "source_refresh" | "serving_rebuild" | "warm_scores" | "daily_sync";

export type JobSuccessStats = {
  fundsUpdated?: number;
  fundsCreated?: number;
  note?: string | null;
};

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isTransientDatabaseError(error: unknown): boolean {
  const message = formatError(error).toLowerCase();
  return (
    message.includes("unable to check out connection from the pool") ||
    message.includes("timed out fetching a new connection") ||
    message.includes("too many clients") ||
    message.includes("connection terminated unexpectedly")
  );
}

async function retryDbCall<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt >= attempts) {
        throw error;
      }
      const waitMs = 500 * attempt;
      console.warn(`[job-runs] ${label} transient db error; retrying`, {
        attempt,
        attempts,
        waitMs,
        message: formatError(error),
      });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, waitMs);
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function recoverStaleJobRuns(staleMinutes = 120): Promise<number> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  const result = await retryDbCall("recover_stale_job_runs", () =>
    prisma.syncLog.updateMany({
      where: {
        completedAt: null,
        startedAt: { lt: cutoff },
        status: { in: ["STARTED", "RUNNING"] },
      },
      data: {
        status: "TIMEOUT",
        completedAt: new Date(),
        errorMessage: `stale_timeout_${staleMinutes}m`,
      },
    })
  );
  return result.count;
}

async function startJobRun(syncType: JobSyncType, staleMinutes: number) {
  await recoverStaleJobRuns(staleMinutes);

  const running = await retryDbCall("start_job_run.find_running", () =>
    prisma.syncLog.findFirst({
      where: {
        syncType,
        completedAt: null,
        status: { in: ["STARTED", "RUNNING"] },
      },
      orderBy: { startedAt: "desc" },
    })
  );

  if (running) {
    return { started: false as const, running };
  }

  const log = await retryDbCall("start_job_run.create", () =>
    prisma.syncLog.create({
      data: {
        syncType,
        status: "RUNNING",
        startedAt: new Date(),
      },
    })
  );

  return { started: true as const, log };
}

async function completeJobRun(logId: string, stats?: JobSuccessStats) {
  const completedAt = new Date();
  const current = await retryDbCall("complete_job_run.read", () =>
    prisma.syncLog.findUnique({
      where: { id: logId },
      select: { startedAt: true },
    })
  );
  const durationMs = current ? Math.max(0, completedAt.getTime() - current.startedAt.getTime()) : null;

  await retryDbCall("complete_job_run.update", () =>
    prisma.syncLog.update({
      where: { id: logId },
      data: {
        status: "SUCCESS",
        completedAt,
        durationMs,
        fundsUpdated: stats?.fundsUpdated ?? 0,
        fundsCreated: stats?.fundsCreated ?? 0,
        errorMessage: stats?.note ?? null,
      },
    })
  );
}

async function failJobRun(logId: string, error: unknown) {
  const completedAt = new Date();
  const current = await retryDbCall("fail_job_run.read", () =>
    prisma.syncLog.findUnique({
      where: { id: logId },
      select: { startedAt: true, syncType: true },
    })
  );
  const durationMs = current ? Math.max(0, completedAt.getTime() - current.startedAt.getTime()) : null;
  const message = formatError(error).slice(0, 1000);

  await retryDbCall("fail_job_run.update", () =>
    prisma.syncLog.update({
      where: { id: logId },
      data: {
        status: "FAILED",
        completedAt,
        durationMs,
        errorMessage: message,
      },
    })
  );

  await sendOpsAlert({
    title: `${current?.syncType ?? "job"} failed`,
    severity: "error",
    lines: [message],
  });
}

export async function runLoggedJob<T>(
  syncType: JobSyncType,
  runner: () => Promise<T>,
  options?: {
    staleMinutes?: number;
    onSuccess?: (result: T) => JobSuccessStats | Promise<JobSuccessStats>;
  }
): Promise<
  | { ok: true; result: T }
  | { ok: false; kind: "already_running"; startedAt: string }
> {
  const staleMinutes = Number.isFinite(options?.staleMinutes) ? Number(options?.staleMinutes) : 120;
  const started = await startJobRun(syncType, staleMinutes);

  if (!started.started) {
    return { ok: false, kind: "already_running", startedAt: started.running.startedAt.toISOString() };
  }

  try {
    const result = await runner();
    const stats = options?.onSuccess ? await options.onSuccess(result) : undefined;
    await completeJobRun(started.log.id, stats);
    return { ok: true, result };
  } catch (error) {
    await failJobRun(started.log.id, error);
    throw error;
  }
}

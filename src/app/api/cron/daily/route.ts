import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { areRuntimeTargetsIdentical, getDbRuntimeTargetDiagnostics } from "@/lib/db-runtime-diagnostics";
import { runDailyPipeline, type DailyPipelineStepState } from "@/lib/pipeline/runDailyPipeline";
import { prisma } from "@/lib/prisma";
import { MARKET_SUMMARY_CACHE_TAG } from "@/lib/services/fund-daily-snapshot.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Serverless invocations cannot outlive `maxDuration`; RUNNING rows left by timeout/crash must recover faster than this. */
export const maxDuration = 300;
/** Overlap guard: block only while a run may still be alive (maxDuration + buffer). Stale RUNNING older than this is finalized in-tx. */
const _ttlRaw = Number(process.env.CRON_DAILY_ACTIVE_RUN_TTL_MS ?? 8 * 60 * 1000);
const DAILY_CRON_ACTIVE_RUN_TTL_MS =
  Number.isFinite(_ttlRaw) && _ttlRaw > 0 ? _ttlRaw : 8 * 60 * 1000;
const DAILY_CRON_STALE_RECOVERY_MARK = "stale_running_route_heartbeat_recovered";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const authHeader = req.headers.get("authorization")?.trim() ?? "";
  return authHeader === `Bearer ${secret}`;
}

function isTimeoutLike(message: string): boolean {
  return /timeout|timed out|_timeout_|stale_timeout|FUNCTION_INVOCATION_TIMEOUT/i.test(message);
}

type PipelineStepProgress = {
  steps: DailyPipelineStepState[];
  firstFailedStep: string | null;
  failureKind: "none" | "exception" | "timeout_suspected";
};

function buildInitialProgress(): PipelineStepProgress {
  return {
    steps: [
      {
        step: "source_refresh",
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        status: "not_started",
      },
      {
        step: "rebuild_daily_snapshots_incremental",
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        status: "not_started",
      },
      {
        step: "rebuild_market_snapshot_from_snapshot",
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        status: "not_started",
      },
    ],
    firstFailedStep: null,
    failureKind: "none",
  };
}

function toSyncLogProgressMessage(input: {
  startedAt: string;
  progress: PipelineStepProgress;
  message?: string;
}): string {
  const payload = {
    phase: "daily_pipeline",
    startedAt: input.startedAt,
    firstFailedStep: input.progress.firstFailedStep,
    failureKind: input.progress.failureKind,
    steps: input.progress.steps.map((step) => ({
      step: step.step,
      status: step.status,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      durationMs: step.durationMs,
      itemsProcessed: step.itemsProcessed,
      error: step.error
        ? {
            type: step.error.type,
            message: step.error.message.slice(0, 240),
          }
        : undefined,
    })),
    message: input.message?.slice(0, 240),
  };

  const raw = JSON.stringify(payload);
  return raw.length > 1900 ? `${raw.slice(0, 1897)}...` : raw;
}

export async function GET(req: NextRequest) {
  const startedAt = new Date().toISOString();
  const diagnosticsTargets = [
    getDbRuntimeTargetDiagnostics("homepage"),
    getDbRuntimeTargetDiagnostics("health"),
    getDbRuntimeTargetDiagnostics("cron"),
  ];
  const diagnosticsIdentity = areRuntimeTargetsIdentical(diagnosticsTargets);
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let heartbeatId: string | null = null;
  let heartbeatWriteError: string | null = null;
  let previousInvocationAt: string | null = null;
  let skippedDueToActiveRun = false;
  let activeRunStartedAt: string | null = null;
  let activeRunAgeMs: number | null = null;
  let activeRunId: string | null = null;
  let staleRunRecovered = false;
  let pipelineProgress: PipelineStepProgress = buildInitialProgress();
  try {
    const txResult = await prisma.$transaction(
      async (tx) => {
        let recoveredStaleRun = false;
        const now = new Date();
        const latestAny = await tx.syncLog.findFirst({
          where: { syncType: "CRON_DAILY_ROUTE" },
          orderBy: { startedAt: "desc" },
          select: { startedAt: true },
        });
        const latestRunning = await tx.syncLog.findFirst({
          where: { syncType: "CRON_DAILY_ROUTE", status: "RUNNING" },
          orderBy: { startedAt: "desc" },
          select: { id: true, startedAt: true },
        });

        if (latestRunning) {
          const ageMs = now.getTime() - latestRunning.startedAt.getTime();
          if (ageMs < DAILY_CRON_ACTIVE_RUN_TTL_MS) {
            return {
              previousInvocationAt: latestAny?.startedAt.toISOString() ?? null,
              skip: true,
              activeRunId: latestRunning.id,
              activeRunStartedAt: latestRunning.startedAt.toISOString(),
              activeRunAgeMs: ageMs,
              staleRunRecovered: false,
              heartbeatId: null as string | null,
            };
          }
          await tx.syncLog.update({
            where: { id: latestRunning.id },
            data: {
              status: "FAILED",
              completedAt: now,
              errorMessage: DAILY_CRON_STALE_RECOVERY_MARK,
              durationMs: Math.max(0, ageMs),
            },
          });
          recoveredStaleRun = true;
        }

        const hb = await tx.syncLog.create({
          data: {
            syncType: "CRON_DAILY_ROUTE",
            status: "RUNNING",
            fundsUpdated: 0,
            fundsCreated: 0,
            startedAt: now,
          },
          select: { id: true },
        });

        return {
          previousInvocationAt: latestAny?.startedAt.toISOString() ?? null,
          skip: false,
          activeRunId: null as string | null,
          activeRunStartedAt: null as string | null,
          activeRunAgeMs: null as number | null,
          staleRunRecovered: recoveredStaleRun,
          heartbeatId: hb.id,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    previousInvocationAt = txResult.previousInvocationAt;
    skippedDueToActiveRun = txResult.skip;
    activeRunStartedAt = txResult.activeRunStartedAt;
    activeRunAgeMs = txResult.activeRunAgeMs;
    activeRunId = txResult.activeRunId;
    staleRunRecovered = txResult.staleRunRecovered;
    heartbeatId = txResult.heartbeatId;
  } catch (error) {
    heartbeatWriteError = error instanceof Error ? error.message : String(error);
  }

  if (skippedDueToActiveRun) {
    return NextResponse.json(
      {
        ok: true,
        success: true,
        skipped: true,
        reason: "active_run",
        guardDecision: "skip_young_active",
        startedAt,
        previousInvocationAt,
        activeRun: {
          id: activeRunId,
          startedAt: activeRunStartedAt,
          ageMs: activeRunAgeMs,
          ttlMs: DAILY_CRON_ACTIVE_RUN_TTL_MS,
        },
        runtimeDbDiagnostics: {
          targets: diagnosticsTargets,
          identicalAcrossPaths: diagnosticsIdentity.identical,
        },
        heartbeatWriteError,
      },
      { status: 202 }
    );
  }

  try {
    const result = await runDailyPipeline({
      onStepUpdate: async (update) => {
        pipelineProgress = {
          steps: update.steps,
          firstFailedStep: update.firstFailedStep,
          failureKind: update.failureKind,
        };
        if (!heartbeatId) return;
        try {
          await prisma.syncLog.update({
            where: { id: heartbeatId },
            data: {
              status: "RUNNING",
              errorMessage: toSyncLogProgressMessage({
                startedAt,
                progress: pipelineProgress,
              }),
            },
          });
        } catch {
          // no-op
        }
      },
    });
    if (heartbeatId) {
      await prisma.syncLog.update({
        where: { id: heartbeatId },
        data: {
          status: "SUCCESS",
          completedAt: new Date(),
          durationMs: result.durationMs,
          fundsUpdated: result.insertedCounts.fundRows,
          fundsCreated: result.insertedCounts.macroRows,
          errorMessage: toSyncLogProgressMessage({
            startedAt,
            progress: {
              steps: result.steps,
              firstFailedStep: result.firstFailedStep,
              failureKind: result.failureKind,
            },
          }),
        },
      });
    }
    revalidateTag(MARKET_SUMMARY_CACHE_TAG);
    return NextResponse.json({
      ok: true,
      success: true,
      staleRunRecovered,
      guardDecision: staleRunRecovered ? "recovered_stale_then_run" : "new_run",
      startedAt,
      previousInvocationAt,
      pipeline: result,
      fetchedCounts: result.fetchedCounts,
      insertedCounts: result.insertedCounts,
      metricsUpdated: result.metricsUpdated,
      latestDateInDb: result.latestDateInDb,
      runtimeDbDiagnostics: {
        targets: diagnosticsTargets,
        identicalAcrossPaths: diagnosticsIdentity.identical,
      },
      heartbeatWriteError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureKind = pipelineProgress.failureKind === "none"
      ? (isTimeoutLike(message) ? "timeout_suspected" : "exception")
      : pipelineProgress.failureKind;
    const firstFailedStep = pipelineProgress.firstFailedStep;
    if (heartbeatId) {
      await prisma.syncLog.update({
        where: { id: heartbeatId },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          errorMessage: toSyncLogProgressMessage({
            startedAt,
            progress: {
              steps: pipelineProgress.steps,
              firstFailedStep,
              failureKind,
            },
            message,
          }),
        },
      });
    }
    console.error("[daily-cron] cron_failed", { startedAt, message });
    return NextResponse.json(
      {
        ok: false,
        success: false,
        startedAt,
        previousInvocationAt,
        error: "pipeline_failed",
        message,
        firstFailedStep,
        failureKind,
        pipeline: {
          steps: pipelineProgress.steps,
          firstFailedStep,
          failureKind,
        },
        runtimeDbDiagnostics: {
          targets: diagnosticsTargets,
          identicalAcrossPaths: diagnosticsIdentity.identical,
        },
        heartbeatWriteError,
      },
      { status: 500 }
    );
  }
}

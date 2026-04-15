import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { getIstanbulWallClock } from "@/lib/daily-sync-policy";
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

type DailySyncRunMeta = {
  phase: "daily_sync";
  runKey: string;
  trigger: "cron_route";
  sourceStatus: "unknown" | "success" | "failed";
  publishStatus: "unknown" | "success" | "failed";
  firstFailedStep: string | null;
  failureKind: "none" | "exception" | "timeout_suspected";
  staleRunRecovered: boolean;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  message?: string;
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

function toDailySyncRunMetaMessage(input: DailySyncRunMeta): string {
  const raw = JSON.stringify(input);
  return raw.length > 1900 ? `${raw.slice(0, 1897)}...` : raw;
}

function computeDailySyncStatuses(progress: PipelineStepProgress): {
  sourceStatus: DailySyncRunMeta["sourceStatus"];
  publishStatus: DailySyncRunMeta["publishStatus"];
} {
  const sourceStep = progress.steps.find((step) => step.step === "source_refresh");
  const publishStep = progress.steps.find((step) => step.step === "rebuild_market_snapshot_from_snapshot");
  return {
    sourceStatus:
      sourceStep?.status === "success"
        ? "success"
        : sourceStep?.status === "error" || sourceStep?.status === "timeout_suspected"
          ? "failed"
          : "unknown",
    publishStatus:
      publishStep?.status === "success"
        ? "success"
        : publishStep?.status === "error" || publishStep?.status === "timeout_suspected"
          ? "failed"
          : "unknown",
  };
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
  let dailySyncLogId: string | null = null;
  let heartbeatWriteError: string | null = null;
  let dailySyncWriteError: string | null = null;
  let previousInvocationAt: string | null = null;
  let skippedDueToActiveRun = false;
  let activeRunStartedAt: string | null = null;
  let activeRunAgeMs: number | null = null;
  let activeRunId: string | null = null;
  let staleRunRecovered = false;
  const runKey = getIstanbulWallClock().dateKey;
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
              dailySyncLogId: null as string | null,
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
        const dailySync = await tx.syncLog.create({
          data: {
            syncType: "daily_sync",
            status: "RUNNING",
            fundsUpdated: 0,
            fundsCreated: 0,
            startedAt: now,
            errorMessage: toDailySyncRunMetaMessage({
              phase: "daily_sync",
              runKey,
              trigger: "cron_route",
              sourceStatus: "unknown",
              publishStatus: "unknown",
              firstFailedStep: null,
              failureKind: "none",
              staleRunRecovered: recoveredStaleRun,
              startedAt,
            }),
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
          dailySyncLogId: dailySync.id,
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
    dailySyncLogId = txResult.dailySyncLogId;
  } catch (error) {
    heartbeatWriteError = error instanceof Error ? error.message : String(error);
    dailySyncWriteError = heartbeatWriteError;
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
        dailySyncWriteError,
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
        if (heartbeatId) {
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
        }
        if (dailySyncLogId) {
          try {
            const statuses = computeDailySyncStatuses(pipelineProgress);
            await prisma.syncLog.update({
              where: { id: dailySyncLogId },
              data: {
                status: "RUNNING",
                errorMessage: toDailySyncRunMetaMessage({
                  phase: "daily_sync",
                  runKey,
                  trigger: "cron_route",
                  sourceStatus: statuses.sourceStatus,
                  publishStatus: statuses.publishStatus,
                  firstFailedStep: pipelineProgress.firstFailedStep,
                  failureKind: pipelineProgress.failureKind,
                  staleRunRecovered,
                  startedAt,
                }),
              },
            });
          } catch {
            // no-op
          }
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
    if (dailySyncLogId) {
      const statuses = computeDailySyncStatuses({
        steps: result.steps,
        firstFailedStep: result.firstFailedStep,
        failureKind: result.failureKind,
      });
      await prisma.syncLog.update({
        where: { id: dailySyncLogId },
        data: {
          status: "SUCCESS",
          completedAt: new Date(),
          durationMs: result.durationMs,
          fundsUpdated: result.insertedCounts.fundRows,
          fundsCreated: result.insertedCounts.macroRows,
          errorMessage: toDailySyncRunMetaMessage({
            phase: "daily_sync",
            runKey,
            trigger: "cron_route",
            sourceStatus: statuses.sourceStatus,
            publishStatus: statuses.publishStatus,
            firstFailedStep: result.firstFailedStep,
            failureKind: result.failureKind,
            staleRunRecovered,
            startedAt,
            finishedAt: result.finishedAt,
            durationMs: result.durationMs,
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
      dailySyncWriteError,
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
    if (dailySyncLogId) {
      const statuses = computeDailySyncStatuses({
        steps: pipelineProgress.steps,
        firstFailedStep,
        failureKind,
      });
      try {
        await prisma.syncLog.update({
          where: { id: dailySyncLogId },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            errorMessage: toDailySyncRunMetaMessage({
              phase: "daily_sync",
              runKey,
              trigger: "cron_route",
              sourceStatus: statuses.sourceStatus,
              publishStatus: statuses.publishStatus,
              firstFailedStep,
              failureKind,
              staleRunRecovered,
              startedAt,
              finishedAt: new Date().toISOString(),
              message,
            }),
          },
        });
      } catch (syncError) {
        dailySyncWriteError = syncError instanceof Error ? syncError.message : String(syncError);
      }
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
        dailySyncWriteError,
      },
      { status: 500 }
    );
  }
}

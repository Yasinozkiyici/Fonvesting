import { runDailySourceRefresh, type DailySourceRefreshResult } from "@/lib/services/daily-source-refresh.service";
import { classifyDailySourceQuality } from "@/lib/pipeline/daily-run-classification";
import {
  runServingDailyIncremental,
  ServingStepError,
  type ServingDailyRefreshResult,
} from "@/lib/services/serving-rebuild.service";
import { readDailyPipelineLatestDates } from "@/lib/pipeline/dailyPipelineDebug";

type DailyStepName =
  | "source_refresh"
  | "rebuild_daily_snapshots_incremental"
  | "rebuild_market_snapshot_from_snapshot";

type DailyStepStatus = "not_started" | "running" | "success" | "error" | "timeout_suspected";

export type DailyPipelineStepState = {
  step: DailyStepName;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  status: DailyStepStatus;
  itemsProcessed?: number;
  partialOutputs?: Record<string, unknown>;
  error?: {
    type: string;
    message: string;
  };
};

export type DailyPipelineRunResult = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  fetchedCounts: {
    fundRows: number;
    macroRows: number;
  };
  insertedCounts: {
    fundRows: number;
    macroRows: number;
  };
  metricsUpdated: {
    snapshotsWritten: number;
    derivedWritten: number;
    cacheWritten: number;
  };
  latestDateInDb: {
    fund: string | null;
    gold: string | null;
    usdtry: string | null;
    interest: string | null;
    metricsUpdatedAt: string | null;
  };
  sourceAttempts: {
    history: number;
    macro: number;
  };
  sourceQuality: {
    kind: "success_with_data" | "successful_noop" | "empty_source_anomaly" | "partial_source_failure";
    reason: string;
  };
  publish: {
    buildId: string | null;
    listRows: number;
    detailRows: number;
    compareRows: number;
    discoveryRows: number;
    fundCoverageRatio: number;
    parseFailureCount: number;
    failedSourceCount: number;
    trusted: boolean;
    outcome: "success" | "partial" | "failed";
  };
  processedSnapshotDate: string | null;
  sourceEffectiveDate: string | null;
  steps: DailyPipelineStepState[];
  firstFailedStep: DailyStepName | null;
  failureKind: "none" | "exception" | "timeout_suspected";
  timings: {
    totalMs: number;
    source: {
      totalMs: number;
      recoveryMs: number;
      historyMs: number;
      macroMs: number;
      attempts: {
        history: number;
        macro: number;
      };
    };
    serving: {
      totalMs: number;
      steps: Array<{
        name: string;
        startedAt: string;
        finishedAt: string;
        durationMs: number;
        details?: Record<string, unknown>;
      }>;
    };
  };
};

export class DailyPipelineError extends Error {
  partial: Partial<DailyPipelineRunResult>;

  constructor(message: string, partial: Partial<DailyPipelineRunResult>) {
    super(message);
    this.name = "DailyPipelineError";
    this.partial = partial;
  }
}

type DailyPipelineOptions = {
  onStepUpdate?: (update: {
    steps: DailyPipelineStepState[];
    firstFailedStep: DailyStepName | null;
    failureKind: "none" | "exception" | "timeout_suspected";
  }) => Promise<void> | void;
};

function nowIso(): string {
  return new Date().toISOString();
}

function makeStep(step: DailyStepName): DailyPipelineStepState {
  return {
    step,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    status: "not_started",
  };
}

function isTimeoutLike(message: string): boolean {
  return /timeout|timed out|_timeout_|stale_timeout/i.test(message);
}

function isSnapshotMaterializedForSource(input: {
  sourceEffectiveDate: string | null;
  processedSnapshotDate: string | null;
}): boolean {
  if (!input.sourceEffectiveDate || !input.processedSnapshotDate) return false;
  const sourceMs = Date.parse(input.sourceEffectiveDate);
  const snapshotMs = Date.parse(input.processedSnapshotDate);
  if (!Number.isFinite(sourceMs) || !Number.isFinite(snapshotMs)) return false;
  return snapshotMs >= sourceMs;
}

export async function runDailyPipeline(options?: DailyPipelineOptions): Promise<DailyPipelineRunResult> {
  const runStartedAtMs = Date.now();
  const startedAt = new Date(runStartedAtMs).toISOString();
  console.info("[daily-cron] cron_started", { startedAt });

  const steps: DailyPipelineStepState[] = [
    makeStep("source_refresh"),
    makeStep("rebuild_daily_snapshots_incremental"),
    makeStep("rebuild_market_snapshot_from_snapshot"),
  ];

  const stepByName = new Map<DailyStepName, DailyPipelineStepState>(steps.map((s) => [s.step, s]));
  let firstFailedStep: DailyStepName | null = null;
  let failureKind: "none" | "exception" | "timeout_suspected" = "none";
  let sourceResult: DailySourceRefreshResult | null = null;
  let servingResult: ServingDailyRefreshResult | null = null;

  const publish = async () => {
    if (!options?.onStepUpdate) return;
    await options.onStepUpdate({
      steps: steps.map((step) => ({ ...step })),
      firstFailedStep,
      failureKind,
    });
  };

  const startStep = async (stepName: DailyStepName) => {
    const step = stepByName.get(stepName);
    if (!step) return;
    step.startedAt = nowIso();
    step.status = "running";
    await publish();
  };

  const completeStep = async (
    stepName: DailyStepName,
    partialOutputs: Record<string, unknown> | undefined,
    itemsProcessed?: number
  ) => {
    const step = stepByName.get(stepName);
    if (!step) return;
    step.finishedAt = nowIso();
    step.durationMs = step.startedAt ? Date.now() - new Date(step.startedAt).getTime() : null;
    step.status = "success";
    if (typeof itemsProcessed === "number") step.itemsProcessed = itemsProcessed;
    if (partialOutputs) step.partialOutputs = partialOutputs;
    await publish();
  };

  const failStep = async (stepName: DailyStepName, error: unknown, partialOutputs?: Record<string, unknown>) => {
    const step = stepByName.get(stepName);
    if (!step) return;
    const message = error instanceof Error ? error.message : String(error);
    const timeoutLike = isTimeoutLike(message);
    step.finishedAt = nowIso();
    step.durationMs = step.startedAt ? Date.now() - new Date(step.startedAt).getTime() : null;
    step.status = timeoutLike ? "timeout_suspected" : "error";
    step.error = {
      type: error instanceof Error ? error.name : "Error",
      message,
    };
    if (partialOutputs) step.partialOutputs = partialOutputs;
    if (!firstFailedStep) firstFailedStep = stepName;
    if (failureKind === "none") failureKind = timeoutLike ? "timeout_suspected" : "exception";
    await publish();
  };

  try {
    await startStep("source_refresh");
    sourceResult = await runDailySourceRefresh();
    await completeStep(
      "source_refresh",
      {
        historyOk: sourceResult.history.ok,
        macroOk: sourceResult.macro.ok,
        macroPartial: sourceResult.macro.partial,
        historyStartDate: sourceResult.history.startDate,
        historyEndDate: sourceResult.history.endDate,
        macroStartDate: sourceResult.macro.startDate,
        macroEndDate: sourceResult.macro.endDate,
      },
      sourceResult.history.writtenRows + sourceResult.macro.writtenRows
    );
  } catch (error) {
    await failStep("source_refresh", error);
    throw error;
  }

  try {
    await startStep("rebuild_daily_snapshots_incremental");
    await startStep("rebuild_market_snapshot_from_snapshot");
    servingResult = await runServingDailyIncremental({ warmCaches: false });

    const servingByName = new Map(servingResult.timings.steps.map((step) => [step.name, step]));
    const snapshotStep = servingByName.get("rebuild_daily_snapshots_incremental");
    const marketStep = servingByName.get("rebuild_market_snapshot_from_snapshot");

    await completeStep(
      "rebuild_daily_snapshots_incremental",
      snapshotStep?.details,
      typeof snapshotStep?.details?.written === "number" ? Number(snapshotStep.details.written) : undefined
    );

    await completeStep(
      "rebuild_market_snapshot_from_snapshot",
      marketStep?.details,
      typeof marketStep?.details?.rows === "number" ? Number(marketStep.details.rows) : undefined
    );
  } catch (error) {
    if (error instanceof ServingStepError) {
      if (error.stepName === "rebuild_daily_snapshots_incremental") {
        await failStep("rebuild_daily_snapshots_incremental", error, error.details);
        const marketStep = stepByName.get("rebuild_market_snapshot_from_snapshot");
        if (marketStep && marketStep.status === "running") {
          marketStep.status = "not_started";
          marketStep.startedAt = null;
          await publish();
        }
      } else if (error.stepName === "rebuild_market_snapshot_from_snapshot") {
        const snapshotStep = stepByName.get("rebuild_daily_snapshots_incremental");
        if (snapshotStep && snapshotStep.status === "running") {
          snapshotStep.status = "success";
          snapshotStep.finishedAt = error.startedAt;
          snapshotStep.durationMs = snapshotStep.startedAt
            ? new Date(error.startedAt).getTime() - new Date(snapshotStep.startedAt).getTime()
            : null;
        }
        await failStep("rebuild_market_snapshot_from_snapshot", error, error.details);
      }
    } else {
      const snapshotStep = stepByName.get("rebuild_daily_snapshots_incremental");
      if (snapshotStep?.status === "running") {
        await failStep("rebuild_daily_snapshots_incremental", error);
      } else {
        await failStep("rebuild_market_snapshot_from_snapshot", error);
      }
    }
    throw error;
  }

  const latestDateInDb = await readDailyPipelineLatestDates();
  const finishedAtMs = Date.now();
  const finishedAt = new Date(finishedAtMs).toISOString();

  if (!sourceResult || !servingResult) {
    throw new Error("daily_pipeline_missing_results");
  }

  const result: DailyPipelineRunResult = {
    startedAt,
    finishedAt,
    durationMs: finishedAtMs - runStartedAtMs,
    fetchedCounts: {
      fundRows: sourceResult.history.fetchedRows,
      macroRows: sourceResult.macro.fetchedRows,
    },
    insertedCounts: {
      fundRows: sourceResult.history.writtenRows,
      macroRows: sourceResult.macro.writtenRows,
    },
    metricsUpdated: {
      snapshotsWritten: servingResult.serving.written,
      derivedWritten: servingResult.derived.written,
      cacheWritten: servingResult.warm.written,
    },
    latestDateInDb,
    sourceAttempts: sourceResult.attempts,
    sourceQuality: classifyDailySourceQuality({
      historyOk: sourceResult.history.ok,
      macroOk: sourceResult.macro.ok,
      fetchedRows: sourceResult.history.fetchedRows,
      writtenRows: sourceResult.history.writtenRows,
    }),
    publish: {
      buildId: servingResult.v2Serving.buildId,
      listRows: servingResult.v2Serving.listRows,
      detailRows: servingResult.v2Serving.detailRows,
      compareRows: servingResult.v2Serving.compareRows,
      discoveryRows: servingResult.v2Serving.discoveryRows,
      fundCoverageRatio: servingResult.v2Serving.fundCoverageRatio,
      parseFailureCount: servingResult.v2Serving.parseFailureCount,
      failedSourceCount: servingResult.v2Serving.failedSourceCount,
      trusted:
        Boolean(servingResult.v2Serving.buildId) &&
        servingResult.v2Serving.listRows > 0 &&
        servingResult.v2Serving.detailRows > 0 &&
        servingResult.v2Serving.compareRows > 0 &&
        servingResult.v2Serving.discoveryRows > 0 &&
        servingResult.v2Serving.fundCoverageRatio >= 0.95,
      outcome:
        Boolean(servingResult.v2Serving.buildId) &&
        servingResult.v2Serving.listRows > 0 &&
        servingResult.v2Serving.detailRows > 0 &&
        servingResult.v2Serving.compareRows > 0 &&
        servingResult.v2Serving.discoveryRows > 0
          ? "success"
          : "partial",
    },
    processedSnapshotDate: servingResult.snapshotDate ?? null,
    sourceEffectiveDate: sourceResult.history.endDate ?? null,
    steps,
    firstFailedStep,
    failureKind,
    timings: {
      totalMs: finishedAtMs - runStartedAtMs,
      source: {
        totalMs: sourceResult.timings.totalMs,
        recoveryMs: sourceResult.timings.recoveryMs,
        historyMs: sourceResult.timings.historyMs,
        macroMs: sourceResult.timings.macroMs,
        attempts: sourceResult.attempts,
      },
      serving: servingResult.timings,
    },
  };

  if (
    !isSnapshotMaterializedForSource({
      sourceEffectiveDate: result.sourceEffectiveDate,
      processedSnapshotDate: result.processedSnapshotDate,
    })
  ) {
    throw new Error(
      `snapshot_not_materialized_for_source source_effective_date=${result.sourceEffectiveDate ?? "none"} processed_snapshot_date=${result.processedSnapshotDate ?? "none"}`
    );
  }

  console.info("[daily-cron] cron_finished", {
    startedAt,
    finishedAt,
    durationMs: result.durationMs,
    success: sourceResult.history.ok && sourceResult.macro.ok,
    steps,
  });

  return result;
}

export function toDailyPipelineError(error: unknown, partial: Partial<DailyPipelineRunResult>): DailyPipelineError {
  const message = error instanceof Error ? error.message : String(error);
  return new DailyPipelineError(message, partial);
}

import { runDailyMaintenance } from "@/lib/services/daily-maintenance.service";
import { readDailyPipelineLatestDates } from "@/lib/pipeline/dailyPipelineDebug";

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
};

export async function runDailyPipeline(): Promise<DailyPipelineRunResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  console.info("[daily-cron] cron_started", { startedAt });
  console.info("[daily-cron] source_fetch_started");

  const result = await runDailyMaintenance();

  console.info("[daily-cron] source_fetch_counts", {
    fundFetchedRows: result.source.history.fetchedRows,
    macroFetchedRows: result.source.macro.fetchedRows,
  });
  console.info("[daily-cron] inserted_row_counts", {
    fundInsertedRows: result.source.history.writtenRows,
    macroInsertedRows: result.source.macro.writtenRows,
  });
  console.info("[daily-cron] metrics_recompute_started");

  const latestDateInDb = await readDailyPipelineLatestDates();
  const finishedAtMs = Date.now();
  const finishedAt = new Date(finishedAtMs).toISOString();

  console.info("[daily-cron] metrics_recompute_finished", {
    snapshotsWritten: result.serving.serving.written,
    derivedWritten: result.serving.derived.written,
    cacheWritten: result.serving.warm.written,
  });
  console.info("[daily-cron] cron_finished", {
    startedAt,
    finishedAt,
    durationMs: finishedAtMs - startedAtMs,
    success: result.source.history.ok && result.source.macro.ok,
  });

  return {
    startedAt,
    finishedAt,
    durationMs: finishedAtMs - startedAtMs,
    fetchedCounts: {
      fundRows: result.source.history.fetchedRows,
      macroRows: result.source.macro.fetchedRows,
    },
    insertedCounts: {
      fundRows: result.source.history.writtenRows,
      macroRows: result.source.macro.writtenRows,
    },
    metricsUpdated: {
      snapshotsWritten: result.serving.serving.written,
      derivedWritten: result.serving.derived.written,
      cacheWritten: result.serving.warm.written,
    },
    latestDateInDb,
    sourceAttempts: result.source.attempts,
  };
}

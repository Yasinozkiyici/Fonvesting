import "../load-env";
import { runDailyPipeline } from "../../src/lib/pipeline/runDailyPipeline";
import { prisma } from "../../src/lib/prisma";
import { classifyDatabaseError } from "../../src/lib/database-error-classifier";
import { fingerprintConnectionUrl, resolveDbConnectionProfile } from "../../src/lib/db/db-connection-profile";
import { toLedgerString, type PipelineRunLedger } from "../../src/lib/pipeline/run-ledger";
import {
  recordCanonicalChartPublish,
  recordCanonicalComparisonPublish,
  readLatestCanonicalSnapshotDate,
  recordCanonicalRawIngest,
  recordCanonicalServingPublish,
  recordCanonicalSnapshot,
} from "../../src/lib/pipeline/canonical-pipeline-store";

function compact(input: PipelineRunLedger): string {
  return toLedgerString(input);
}

function resolveStatuses(steps: Array<{ step: string; status: string }>) {
  const source = steps.find((step) => step.step === "source_refresh")?.status;
  const publish = steps.find((step) => step.step === "rebuild_market_snapshot_from_snapshot")?.status;
  return {
    sourceStatus: source === "success" ? "success" : source === "error" || source === "timeout_suspected" ? "failed" : "unknown",
    publishStatus:
      publish === "success" ? "success" : publish === "error" || publish === "timeout_suspected" ? "failed" : "unknown",
  } as const;
}

async function main() {
  const dbProfile = resolveDbConnectionProfile();
  const dbFp = fingerprintConnectionUrl(dbProfile.effectiveDatasourceUrl);
  console.info(
    `[daily-sync-infra] datasource_env=${dbProfile.prismaRuntimeEnvKey} mode=${dbProfile.connectionMode} ` +
      `pgbouncer=${dbProfile.tuning.pgbouncer ? 1 : 0} connection_limit=${dbProfile.tuning.connectionLimit ?? "na"} ` +
      `pool_timeout_s=${dbProfile.tuning.poolTimeoutSec ?? "na"} connect_timeout_s=${dbProfile.tuning.connectTimeoutSec ?? "na"} ` +
      `host_hash=${dbFp.hostHash ?? "none"} db_hash=${dbFp.dbHash ?? "none"}`
  );
  const startedAt = new Date().toISOString();
  const runKey = new Date().toISOString().slice(0, 10);
  const runId = `daily-${Date.now()}`;
  const initialLedger: PipelineRunLedger = {
    schemaVersion: "v2",
    phase: "daily_sync",
    runId,
    runKey,
    trigger: "cli_script",
    startedAt,
    finishedAt: null,
    sourceEffectiveDate: null,
    sourceFetch: { status: "running", startedAt, finishedAt: null },
    rawIngest: { status: "not_started", startedAt: null, finishedAt: null },
    normalizedSnapshot: { status: "not_started", startedAt: null, finishedAt: null },
    servingPublish: { status: "not_started", startedAt: null, finishedAt: null },
    chartPublish: { status: "not_started", startedAt: null, finishedAt: null },
    returnComparisonPublish: { status: "not_started", startedAt: null, finishedAt: null },
    freshnessPublish: { status: "not_started", startedAt: null, finishedAt: null },
    finalStatus: "running",
    failureClass: "none",
    failureReason: null,
    counts: {
      fetchedFundRows: 0,
      writtenFundRows: 0,
      normalizedRows: 0,
      servingListRows: 0,
      servingDetailRows: 0,
      chartRows: 0,
      comparisonRows: 0,
    },
  };
  const syncLog = await prisma.syncLog
    .create({
      data: {
        syncType: "daily_sync",
        status: "RUNNING",
        fundsUpdated: 0,
        fundsCreated: 0,
        startedAt: new Date(),
        errorMessage: compact(initialLedger),
      },
      select: { id: true },
    })
    .catch(() => null);

  try {
    const result = await runDailyPipeline();
    const statuses = resolveStatuses(result.steps);
    const nowIso = new Date().toISOString();
    const ledger: PipelineRunLedger = {
      ...initialLedger,
      finishedAt: result.finishedAt,
      sourceEffectiveDate: result.processedSnapshotDate ?? null,
      sourceFetch: {
        status: statuses.sourceStatus === "success" ? "success" : "failed",
        startedAt: result.steps.find((step) => step.step === "source_refresh")?.startedAt ?? startedAt,
        finishedAt: result.steps.find((step) => step.step === "source_refresh")?.finishedAt ?? nowIso,
        effectiveDate: result.processedSnapshotDate ?? null,
        rowCount: result.fetchedCounts.fundRows,
      },
      rawIngest: {
        status: result.insertedCounts.fundRows > 0 ? "success" : "noop",
        startedAt: result.steps.find((step) => step.step === "source_refresh")?.startedAt ?? startedAt,
        finishedAt: result.steps.find((step) => step.step === "source_refresh")?.finishedAt ?? nowIso,
        effectiveDate: result.sourceEffectiveDate ?? result.processedSnapshotDate ?? null,
        rowCount: result.insertedCounts.fundRows,
      },
      normalizedSnapshot: {
        status: result.metricsUpdated.snapshotsWritten > 0 ? "success" : "failed",
        startedAt: result.steps.find((step) => step.step === "rebuild_daily_snapshots_incremental")?.startedAt ?? startedAt,
        finishedAt: result.steps.find((step) => step.step === "rebuild_daily_snapshots_incremental")?.finishedAt ?? nowIso,
        effectiveDate: result.processedSnapshotDate ?? null,
        rowCount: result.metricsUpdated.snapshotsWritten,
      },
      servingPublish: {
        status: result.publish.outcome === "success" ? "success" : "failed",
        startedAt: result.steps.find((step) => step.step === "rebuild_market_snapshot_from_snapshot")?.startedAt ?? startedAt,
        finishedAt: result.steps.find((step) => step.step === "rebuild_market_snapshot_from_snapshot")?.finishedAt ?? nowIso,
        effectiveDate: result.processedSnapshotDate ?? null,
        rowCount: result.publish.listRows,
      },
      chartPublish: {
        status: result.publish.detailRows > 0 ? "success" : "failed",
        startedAt: result.finishedAt,
        finishedAt: result.finishedAt,
        effectiveDate: result.processedSnapshotDate ?? null,
        rowCount: result.publish.detailRows,
      },
      returnComparisonPublish: {
        status: result.publish.compareRows > 0 ? "success" : "failed",
        startedAt: result.finishedAt,
        finishedAt: result.finishedAt,
        effectiveDate: result.processedSnapshotDate ?? null,
        rowCount: result.publish.compareRows,
      },
      freshnessPublish: {
        status: "success",
        startedAt: result.finishedAt,
        finishedAt: result.finishedAt,
        effectiveDate: result.processedSnapshotDate ?? null,
      },
      finalStatus:
        result.publish.outcome === "success" && result.sourceQuality.kind !== "partial_source_failure" ? "success" : "partial",
      failureClass: result.failureKind,
      failureReason: result.firstFailedStep ?? null,
      counts: {
        fetchedFundRows: result.fetchedCounts.fundRows,
        writtenFundRows: result.insertedCounts.fundRows,
        normalizedRows: result.metricsUpdated.snapshotsWritten,
        servingListRows: result.publish.listRows,
        servingDetailRows: result.publish.detailRows,
        chartRows: result.publish.detailRows,
        comparisonRows: result.publish.compareRows,
      },
    };
    await recordCanonicalRawIngest({
      runId,
      triggerType: "cli_script",
      sourceEffectiveDate: result.sourceEffectiveDate ?? result.processedSnapshotDate ?? null,
      fetchedRows: result.fetchedCounts.fundRows,
      writtenRows: result.insertedCounts.fundRows,
      fetchSucceeded: statuses.sourceStatus === "success",
      writeSucceeded: result.insertedCounts.fundRows > 0 || result.sourceQuality.kind === "successful_noop",
      isNoop: result.insertedCounts.fundRows === 0,
      stageStatus: statuses.sourceStatus === "success" ? "success" : "failed",
      stageReason: statuses.sourceStatus === "success" ? null : result.sourceQuality.reason,
    });
    await recordCanonicalSnapshot({
      runId,
      snapshotDate: result.processedSnapshotDate,
      rowsWritten: result.metricsUpdated.snapshotsWritten,
      stageStatus: result.metricsUpdated.snapshotsWritten > 0 ? "success" : "failed",
      stageReason: result.metricsUpdated.snapshotsWritten > 0 ? null : "snapshot_rows_not_written",
    });
    await recordCanonicalServingPublish({
      runId,
      buildId: result.publish.buildId,
      snapshotDate: result.processedSnapshotDate,
      listRows: result.publish.listRows,
      detailRows: result.publish.detailRows,
      compareRows: result.publish.compareRows,
      discoveryRows: result.publish.discoveryRows,
      stageStatus: result.publish.outcome === "success" ? "success" : "failed",
      stageReason: result.publish.outcome === "success" ? null : "serving_publish_partial_or_failed",
    });
    await recordCanonicalChartPublish({
      runId,
      buildId: result.publish.buildId,
      snapshotDate: result.processedSnapshotDate,
      chartRows: result.publish.detailRows,
      stageStatus: result.publish.detailRows > 0 ? "success" : "failed",
      stageReason: result.publish.detailRows > 0 ? null : "chart_publish_rows_not_written",
    });
    await recordCanonicalComparisonPublish({
      runId,
      buildId: result.publish.buildId,
      snapshotDate: result.processedSnapshotDate,
      comparisonRows: result.publish.compareRows,
      stageStatus: result.publish.compareRows > 0 ? "success" : "failed",
      stageReason: result.publish.compareRows > 0 ? null : "comparison_publish_rows_not_written",
    });
    const latestCanonicalSnapshotDate = await readLatestCanonicalSnapshotDate();
    ledger.normalizedSnapshot.reason =
      latestCanonicalSnapshotDate && result.processedSnapshotDate !== latestCanonicalSnapshotDate
        ? `canonical_latest_snapshot_mismatch:${latestCanonicalSnapshotDate}`
        : ledger.normalizedSnapshot.reason ?? null;
    if (syncLog?.id) {
      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: "SUCCESS",
          completedAt: new Date(),
          durationMs: result.durationMs,
          fundsUpdated: result.insertedCounts.fundRows,
          fundsCreated: result.insertedCounts.macroRows,
          errorMessage: compact(ledger),
        },
      });
    }
    console.log(JSON.stringify(result, null, 2));
    const failed = result.firstFailedStep !== null || result.failureKind !== "none";
    process.exit(failed ? 1 : 0);
  } catch (error) {
    const classified = classifyDatabaseError(error);
    console.error(
      `[daily-sync-infra-failure] class=${classified.category} prisma_code=${classified.prismaCode ?? "none"} ` +
        `retryable=${classified.retryable ? 1 : 0} env=${dbProfile.prismaRuntimeEnvKey} mode=${dbProfile.connectionMode}`
    );
    if (syncLog?.id) {
      const message = error instanceof Error ? error.message : String(error);
      await recordCanonicalRawIngest({
        runId,
        triggerType: "cli_script",
        sourceEffectiveDate: null,
        fetchedRows: 0,
        writtenRows: 0,
        fetchSucceeded: false,
        writeSucceeded: false,
        isNoop: false,
        stageStatus: "failed",
        stageReason: message.slice(0, 400),
      }).catch(() => {});
      await recordCanonicalSnapshot({
        runId,
        snapshotDate: null,
        rowsWritten: 0,
        stageStatus: "failed",
        stageReason: message.slice(0, 400),
      }).catch(() => {});
      await recordCanonicalServingPublish({
        runId,
        buildId: null,
        snapshotDate: null,
        listRows: 0,
        detailRows: 0,
        compareRows: 0,
        discoveryRows: 0,
        stageStatus: "failed",
        stageReason: message.slice(0, 400),
      }).catch(() => {});
      await recordCanonicalChartPublish({
        runId,
        buildId: null,
        snapshotDate: null,
        chartRows: 0,
        stageStatus: "failed",
        stageReason: message.slice(0, 400),
      }).catch(() => {});
      await recordCanonicalComparisonPublish({
        runId,
        buildId: null,
        snapshotDate: null,
        comparisonRows: 0,
        stageStatus: "failed",
        stageReason: message.slice(0, 400),
      }).catch(() => {});
      const failedLedger: PipelineRunLedger = {
        ...initialLedger,
        finishedAt: new Date().toISOString(),
        sourceFetch: { ...initialLedger.sourceFetch, status: "failed", finishedAt: new Date().toISOString(), reason: message },
        finalStatus: "failed",
        failureClass: "exception",
        failureReason: message.slice(0, 400),
      };
      await prisma.syncLog
        .update({
          where: { id: syncLog.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            errorMessage: compact(failedLedger),
          },
        })
        .catch(() => {});
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

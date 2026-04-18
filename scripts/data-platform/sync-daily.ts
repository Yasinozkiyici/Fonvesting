import "../load-env";
import { runDailyPipeline } from "../../src/lib/pipeline/runDailyPipeline";
import { prisma } from "../../src/lib/prisma";
import { stringifySyncLogMeta } from "../../src/lib/sync-log-meta-json";

function compact(input: Record<string, unknown>): string {
  return stringifySyncLogMeta(input);
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
  const startedAt = new Date().toISOString();
  const runKey = new Date().toISOString().slice(0, 10);
  const syncLog = await prisma.syncLog
    .create({
      data: {
        syncType: "daily_sync",
        status: "RUNNING",
        fundsUpdated: 0,
        fundsCreated: 0,
        startedAt: new Date(),
        errorMessage: compact({
          phase: "daily_sync",
          runKey,
          trigger: "cli_script",
          outcome: "running",
          sourceStatus: "unknown",
          publishStatus: "unknown",
          firstFailedStep: null,
          failureKind: "none",
          staleRunRecovered: false,
          startedAt,
        }),
      },
      select: { id: true },
    })
    .catch(() => null);

  try {
    const result = await runDailyPipeline();
    const statuses = resolveStatuses(result.steps);
    if (syncLog?.id) {
      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: "SUCCESS",
          completedAt: new Date(),
          durationMs: result.durationMs,
          fundsUpdated: result.insertedCounts.fundRows,
          fundsCreated: result.insertedCounts.macroRows,
          errorMessage: compact({
            phase: "daily_sync",
            runKey,
            trigger: "cli_script",
            outcome:
              result.publish.outcome === "success" && result.sourceQuality.kind !== "partial_source_failure"
                ? "success"
                : "partial",
            sourceStatus: statuses.sourceStatus,
            publishStatus: statuses.publishStatus,
            sourceQuality: result.sourceQuality.kind,
            sourceQualityReason: result.sourceQuality.reason,
            processedSnapshotDate: result.processedSnapshotDate,
            fetchedFundRows: result.fetchedCounts.fundRows,
            writtenFundRows: result.insertedCounts.fundRows,
            canonicalRowsWritten: result.metricsUpdated.snapshotsWritten,
            publishBuildId: result.publish.buildId,
            publishListRows: result.publish.listRows,
            publishDetailRows: result.publish.detailRows,
            publishCompareRows: result.publish.compareRows,
            publishDiscoveryRows: result.publish.discoveryRows,
            publishCoverageRatio: result.publish.fundCoverageRatio,
            firstFailedStep: result.firstFailedStep,
            failureKind: result.failureKind,
            staleRunRecovered: false,
            startedAt: result.startedAt,
            finishedAt: result.finishedAt,
            durationMs: result.durationMs,
          }),
        },
      });
    }
    console.log(JSON.stringify(result, null, 2));
    const failed = result.firstFailedStep !== null || result.failureKind !== "none";
    process.exit(failed ? 1 : 0);
  } catch (error) {
    if (syncLog?.id) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.syncLog
        .update({
          where: { id: syncLog.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            errorMessage: compact({
              phase: "daily_sync",
              runKey,
              trigger: "cli_script",
              outcome: "failed",
              sourceStatus: "failed",
              publishStatus: "failed",
              sourceQuality: "partial_source_failure",
              sourceQualityReason: message.slice(0, 400),
              processedSnapshotDate: null,
              publishBuildId: null,
              firstFailedStep: null,
              failureKind: "exception",
              staleRunRecovered: false,
              startedAt,
              finishedAt: new Date().toISOString(),
              message,
            }),
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

import { stringifySyncLogMeta } from "@/lib/sync-log-meta-json";
import { parseDailySyncRunMeta, type DailySyncRunMeta } from "@/lib/daily-sync-run-meta";

export type PipelineStageStatus = "not_started" | "running" | "success" | "failed" | "noop";
export type PipelineFinalStatus = "running" | "success" | "partial" | "failed";

export type PipelineStageLedger = {
  status: PipelineStageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  effectiveDate?: string | null;
  rowCount?: number | null;
  reason?: string | null;
};

export type PipelineRunLedger = {
  schemaVersion: "v2";
  phase: "daily_sync";
  runId: string;
  runKey: string;
  trigger: "cron" | "manual" | "recovery" | "cli_script";
  startedAt: string;
  finishedAt: string | null;
  sourceEffectiveDate: string | null;
  sourceFetch: PipelineStageLedger;
  rawIngest: PipelineStageLedger;
  normalizedSnapshot: PipelineStageLedger;
  servingPublish: PipelineStageLedger;
  chartPublish: PipelineStageLedger;
  returnComparisonPublish: PipelineStageLedger;
  freshnessPublish: PipelineStageLedger;
  finalStatus: PipelineFinalStatus;
  failureClass: "none" | "exception" | "timeout_suspected";
  failureReason: string | null;
  counts: {
    fetchedFundRows: number;
    writtenFundRows: number;
    normalizedRows: number;
    servingListRows: number;
    servingDetailRows: number;
    chartRows: number;
    comparisonRows: number;
  };
};

export function toLedgerString(ledger: PipelineRunLedger): string {
  return stringifySyncLogMeta(ledger as unknown as Record<string, unknown>);
}

export function parseRunLedgerFromSyncLog(message: string | null | undefined): PipelineRunLedger | null {
  if (!message) return null;
  try {
    const parsed = JSON.parse(message) as Record<string, unknown>;
    if (parsed.schemaVersion === "v2" && parsed.phase === "daily_sync" && typeof parsed.runId === "string") {
      return parsed as unknown as PipelineRunLedger;
    }
  } catch {
    return null;
  }
  return null;
}

export function deriveLegacyMetaFromLedger(ledger: PipelineRunLedger): DailySyncRunMeta {
  return {
    phase: ledger.phase,
    runKey: ledger.runKey,
    trigger: ledger.trigger,
    outcome: ledger.finalStatus,
    sourceStatus: ledger.sourceFetch.status === "success" ? "success" : "failed",
    publishStatus: ledger.servingPublish.status === "success" ? "success" : "failed",
    processedSnapshotDate: ledger.normalizedSnapshot.effectiveDate ?? null,
    fetchedFundRows: ledger.counts.fetchedFundRows,
    writtenFundRows: ledger.counts.writtenFundRows,
    canonicalRowsWritten: ledger.counts.normalizedRows,
    publishBuildId: null,
    publishListRows: ledger.counts.servingListRows,
    publishDetailRows: ledger.counts.servingDetailRows,
    publishCompareRows: ledger.counts.comparisonRows,
    publishDiscoveryRows: 0,
    firstFailedStep: null,
    failureKind: ledger.failureClass,
    staleRunRecovered: false,
  };
}

export function parseDailySyncMetaWithLedgerFallback(message: string | null | undefined): DailySyncRunMeta | null {
  const next = parseRunLedgerFromSyncLog(message);
  if (next) return deriveLegacyMetaFromLedger(next);
  return parseDailySyncRunMeta(message);
}

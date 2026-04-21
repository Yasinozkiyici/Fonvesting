export type DailySyncRunMeta = {
  phase?: string;
  runKey?: string;
  trigger?: string;
  outcome?: "running" | "success" | "partial" | "failed" | "timeout_suspected";
  sourceStatus?: string;
  publishStatus?: string;
  sourceQuality?: "success_with_data" | "successful_noop" | "empty_source_anomaly" | "partial_source_failure";
  sourceQualityReason?: string;
  processedSnapshotDate?: string | null;
  fetchedFundRows?: number;
  writtenFundRows?: number;
  canonicalRowsWritten?: number;
  publishBuildId?: string | null;
  publishListRows?: number;
  publishDetailRows?: number;
  publishCompareRows?: number;
  publishDiscoveryRows?: number;
  publishCoverageRatio?: number;
  firstFailedStep?: string | null;
  failureKind?: "none" | "exception" | "timeout_suspected";
  staleRunRecovered?: boolean;
  metaTruncated?: boolean;
};

/**
 * Transitional parser for legacy daily_sync JSON meta.
 * Canonical reader path is `parseDailySyncMetaWithLedgerFallback` in run-ledger.
 */
export function parseDailySyncRunMeta(message: string | null | undefined): DailySyncRunMeta | null {
  if (!message) return null;
  try {
    const parsed = JSON.parse(message) as Record<string, unknown>;
    if (typeof parsed !== "object" || !parsed) return null;
    const normalizeString = (value: unknown): string | undefined =>
      typeof value === "string" && value.trim().length > 0 ? value : undefined;
    const normalizeNumber = (value: unknown): number | undefined =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    const normalizeBoolean = (value: unknown): boolean | undefined =>
      typeof value === "boolean" ? value : undefined;
    return {
      phase: normalizeString(parsed.phase),
      runKey: normalizeString(parsed.runKey),
      trigger: normalizeString(parsed.trigger),
      outcome:
        parsed.outcome === "running" ||
        parsed.outcome === "success" ||
        parsed.outcome === "partial" ||
        parsed.outcome === "failed" ||
        parsed.outcome === "timeout_suspected"
          ? parsed.outcome
          : undefined,
      sourceStatus:
        parsed.sourceStatus === "success" || parsed.sourceStatus === "failed"
          ? parsed.sourceStatus
          : undefined,
      publishStatus:
        parsed.publishStatus === "success" || parsed.publishStatus === "failed"
          ? parsed.publishStatus
          : undefined,
      sourceQuality:
        parsed.sourceQuality === "success_with_data" ||
        parsed.sourceQuality === "successful_noop" ||
        parsed.sourceQuality === "empty_source_anomaly" ||
        parsed.sourceQuality === "partial_source_failure"
          ? parsed.sourceQuality
          : undefined,
      sourceQualityReason: normalizeString(parsed.sourceQualityReason),
      processedSnapshotDate:
        parsed.processedSnapshotDate === null || typeof parsed.processedSnapshotDate === "string"
          ? (parsed.processedSnapshotDate as string | null)
          : undefined,
      fetchedFundRows: normalizeNumber(parsed.fetchedFundRows),
      writtenFundRows: normalizeNumber(parsed.writtenFundRows),
      canonicalRowsWritten: normalizeNumber(parsed.canonicalRowsWritten),
      publishBuildId:
        parsed.publishBuildId === null || typeof parsed.publishBuildId === "string"
          ? (parsed.publishBuildId as string | null)
          : undefined,
      publishListRows: normalizeNumber(parsed.publishListRows),
      publishDetailRows: normalizeNumber(parsed.publishDetailRows),
      publishCompareRows: normalizeNumber(parsed.publishCompareRows),
      publishDiscoveryRows: normalizeNumber(parsed.publishDiscoveryRows),
      publishCoverageRatio: normalizeNumber(parsed.publishCoverageRatio),
      firstFailedStep:
        parsed.firstFailedStep === null || typeof parsed.firstFailedStep === "string"
          ? (parsed.firstFailedStep as string | null)
          : undefined,
      failureKind:
        parsed.failureKind === "none" ||
        parsed.failureKind === "exception" ||
        parsed.failureKind === "timeout_suspected"
          ? parsed.failureKind
          : undefined,
      staleRunRecovered: normalizeBoolean(parsed.staleRunRecovered),
      metaTruncated: normalizeBoolean(parsed.metaTruncated),
    };
  } catch {
    return null;
  }
}


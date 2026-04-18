/**
 * SyncLog.errorMessage için JSON serileştirme — günlük truth alanlarının kesilmemesi için yeterli üst sınır.
 */
const DEFAULT_MAX = 65_535;

export function getSyncLogMetaJsonMaxLength(): number {
  const raw = Number(process.env.SYNC_LOG_JSON_MAX_LENGTH ?? DEFAULT_MAX);
  if (!Number.isFinite(raw) || raw < 2_000) return DEFAULT_MAX;
  return Math.min(Math.floor(raw), 1_000_000);
}

function slimDailyTruthPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const reason = payload.sourceQualityReason;
  return {
    phase: payload.phase,
    runKey: payload.runKey,
    trigger: payload.trigger,
    outcome: payload.outcome,
    sourceStatus: payload.sourceStatus,
    publishStatus: payload.publishStatus,
    sourceQuality: payload.sourceQuality,
    sourceQualityReason: typeof reason === "string" ? reason.slice(0, 240) : reason,
    processedSnapshotDate: payload.processedSnapshotDate,
    publishBuildId: payload.publishBuildId,
    fetchedFundRows: payload.fetchedFundRows,
    writtenFundRows: payload.writtenFundRows,
    canonicalRowsWritten: payload.canonicalRowsWritten,
    publishListRows: payload.publishListRows,
    publishDetailRows: payload.publishDetailRows,
    publishCompareRows: payload.publishCompareRows,
    publishDiscoveryRows: payload.publishDiscoveryRows,
    publishCoverageRatio: payload.publishCoverageRatio,
    firstFailedStep: payload.firstFailedStep,
    failureKind: payload.failureKind,
    staleRunRecovered: payload.staleRunRecovered,
    startedAt: payload.startedAt,
    finishedAt: payload.finishedAt,
    durationMs: payload.durationMs,
    message: typeof payload.message === "string" ? payload.message.slice(0, 240) : payload.message,
    metaTruncated: true,
  };
}

export function stringifySyncLogMeta(payload: unknown): string {
  const max = getSyncLogMetaJsonMaxLength();
  const raw = JSON.stringify(payload);
  if (raw.length <= max) return raw;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const slim = JSON.stringify(slimDailyTruthPayload(payload as Record<string, unknown>));
    if (slim.length <= max) return slim;
  }
  return JSON.stringify({ metaTruncated: true, error: "sync_log_meta_oversized" });
}

/**
 * Son N adet `daily_sync` SyncLog satırında truth alanlarının ardışık doluluğunu raporlar.
 * Health/gate ile aynı meta ayrıştırmasını kullanır (`parseDailySyncMetaWithLedgerFallback`).
 * Varsayılan: yalnızca `completedAt` dolu (terminal) run’lar — RUNNING hayaletleri strict penceresinden çıkar.
 * Tüm run’lar için: `--include-running`
 */
import "../load-env";
import { parseDailySyncMetaWithLedgerFallback } from "../../src/lib/pipeline/run-ledger";
import { prisma } from "../../src/lib/prisma";

type DailySyncRow = {
  id: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  fundsUpdated: number;
  errorMessage: string | null;
};

type TruthView = {
  outcome: string;
  sourceStatus: string;
  publishStatus: string;
  sourceQuality: string;
  processedSnapshotDate: string | null;
  publishBuildId: string | null;
};

function parseLimit(argv: string[]): number {
  const args = argv.filter((a) => a !== "--");
  const eq = args.find((a) => a.startsWith("--limit="))?.split("=", 2)[1];
  const idx = args.indexOf("--limit");
  const next = idx >= 0 ? args[idx + 1] : undefined;
  const raw = eq ?? (next && !next.startsWith("-") ? next : undefined);
  const n = raw ? Number(raw) : 10;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : 10;
}

function resolveTruthFields(row: DailySyncRow): TruthView {
  const meta = parseDailySyncMetaWithLedgerFallback(row.errorMessage);
  const outcome =
    meta?.outcome === "running" ||
    meta?.outcome === "success" ||
    meta?.outcome === "partial" ||
    meta?.outcome === "failed" ||
    meta?.outcome === "timeout_suspected"
      ? meta.outcome
      : row.status === "RUNNING"
        ? "running"
        : row.status === "SUCCESS"
          ? "success"
          : row.status === "FAILED" || row.status === "TIMEOUT"
            ? "failed"
            : "unknown";
  const sourceStatus =
    meta?.sourceStatus === "success" || meta?.sourceStatus === "failed"
      ? meta.sourceStatus
      : row.status === "SUCCESS"
        ? "success"
        : row.status === "FAILED" || row.status === "TIMEOUT"
          ? "failed"
          : "unknown";
  const publishStatus =
    meta?.publishStatus === "success" || meta?.publishStatus === "failed"
      ? meta.publishStatus
      : row.status === "SUCCESS"
        ? "success"
        : row.status === "FAILED" || row.status === "TIMEOUT"
          ? "failed"
          : "unknown";
  let sourceQuality: string =
    meta?.sourceQuality === "success_with_data" ||
    meta?.sourceQuality === "successful_noop" ||
    meta?.sourceQuality === "empty_source_anomaly" ||
    meta?.sourceQuality === "partial_source_failure"
      ? meta.sourceQuality
      : row.status === "SUCCESS"
        ? row.fundsUpdated > 0
          ? "success_with_data"
          : "successful_noop"
        : "unknown";
  if (sourceQuality === "unknown" && (row.status === "FAILED" || row.status === "TIMEOUT")) {
    sourceQuality = "partial_source_failure";
  }
  const processedSnapshotDate: string | null =
    typeof meta?.processedSnapshotDate === "string" && meta.processedSnapshotDate.length > 0
      ? meta.processedSnapshotDate
      : null;
  const publishBuildId: string | null =
    typeof meta?.publishBuildId === "string" && meta.publishBuildId.length > 0 ? meta.publishBuildId : null;

  return { outcome, sourceStatus, publishStatus, sourceQuality, processedSnapshotDate, publishBuildId };
}

function terminalRunStrictOk(row: DailySyncRow & { jobStatus: string }, t: TruthView): boolean {
  if (row.jobStatus === "SUCCESS") {
    return (
      t.outcome === "success" &&
      t.sourceStatus === "success" &&
      t.publishStatus === "success" &&
      t.sourceQuality !== "unknown" &&
      t.processedSnapshotDate != null &&
      t.publishBuildId != null
    );
  }
  if (row.jobStatus === "FAILED" || row.jobStatus === "TIMEOUT") {
    return (
      (t.outcome === "failed" || t.outcome === "timeout_suspected") &&
      t.sourceQuality !== "unknown" &&
      t.sourceStatus !== "unknown" &&
      t.publishStatus !== "unknown"
    );
  }
  return false;
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const limit = parseLimit(argv);
  const asJson = argv.includes("--json");
  const strict = argv.includes("--strict");
  const includeRunning = argv.includes("--include-running");

  const rowsDesc = await prisma.syncLog.findMany({
    where: {
      syncType: "daily_sync",
      ...(includeRunning ? {} : { completedAt: { not: null } }),
    },
    orderBy: includeRunning ? { startedAt: "desc" } : { completedAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      fundsUpdated: true,
      errorMessage: true,
    },
  });

  const chronological = [...rowsDesc].reverse();
  const runs = chronological.map((row) => {
    const metaOnce = parseDailySyncMetaWithLedgerFallback(row.errorMessage);
    const truth = resolveTruthFields(row);
    const metaParsed = metaOnce != null;
    return {
      id: row.id,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      jobStatus: row.status,
      metaJsonParsed: metaParsed,
      ...truth,
      strictTruthComplete: terminalRunStrictOk({ ...row, jobStatus: row.status }, truth),
    };
  });

  const allStrictComplete = runs.length > 0 && runs.every((r) => r.strictTruthComplete);
  const missingPublishBuildId = runs
    .filter((r) => r.jobStatus === "SUCCESS" && r.publishBuildId == null)
    .map((r) => r.startedAt);
  const missingProcessedSnapshot = runs
    .filter((r) => r.jobStatus === "SUCCESS" && r.processedSnapshotDate == null)
    .map((r) => r.startedAt);
  const unknownOutcome = runs.filter((r) => r.outcome === "unknown").map((r) => r.startedAt);
  const unknownSourceQuality = runs.filter((r) => r.sourceQuality === "unknown").map((r) => r.startedAt);
  const unparsedMeta = runs.filter((r) => !r.metaJsonParsed).map((r) => r.startedAt);

  const evidence = {
    generatedAt: new Date().toISOString(),
    limit,
    windowMode: includeRunning ? "all_runs_by_startedAt" : "terminal_runs_by_completedAt",
    runCount: runs.length,
    consecutiveStrictTruthComplete: allStrictComplete,
    gaps: {
      missingPublishBuildId,
      missingProcessedSnapshotDate: missingProcessedSnapshot,
      outcomeUnknown: unknownOutcome,
      sourceQualityUnknown: unknownSourceQuality,
      errorMessageMetaNotJson: unparsedMeta,
    },
    runs,
  };

  if (asJson) {
    console.log(JSON.stringify(evidence, null, 2));
  } else {
    console.log(
      `Daily ledger evidence (last ${limit} daily_sync rows, ${includeRunning ? "all statuses" : "terminal only"}, oldest → newest)\n`
    );
    for (const r of runs) {
      const mark = r.strictTruthComplete ? "✓" : "✗";
      console.log(
        `${mark} ${r.startedAt} | outcome=${r.outcome} src=${r.sourceStatus} pub=${r.publishStatus} qual=${r.sourceQuality}`
      );
      console.log(
        `    processedSnapshotDate=${r.processedSnapshotDate ?? "(null)"} publishBuildId=${r.publishBuildId ?? "(null)"} metaParsed=${r.metaJsonParsed}`
      );
    }
    console.log("\nSummary:");
    console.log(`  consecutiveStrictTruthComplete: ${allStrictComplete}`);
    console.log(`  missing publishBuildId: ${missingPublishBuildId.length}`);
    console.log(`  missing processedSnapshotDate: ${missingProcessedSnapshot.length}`);
    console.log(`  outcome unknown: ${unknownOutcome.length}`);
    console.log(`  sourceQuality unknown: ${unknownSourceQuality.length}`);
    console.log(`  errorMessage not JSON meta: ${unparsedMeta.length}`);
  }

  if (strict && !allStrictComplete) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

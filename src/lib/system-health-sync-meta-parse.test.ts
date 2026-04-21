import assert from "node:assert/strict";
import test from "node:test";
import { parseDailySyncRunMeta } from "@/lib/daily-sync-run-meta";
import { parseDailySyncMetaWithLedgerFallback } from "@/lib/pipeline/run-ledger";

test("parseDailySyncRunMeta: malformed JSON null döner", () => {
  assert.equal(parseDailySyncRunMeta("{not-json"), null);
});

test("parseDailySyncRunMeta: bilinmeyen alanları normalize eder", () => {
  const meta = parseDailySyncRunMeta(
    JSON.stringify({
      phase: "daily_sync",
      sourceStatus: "success",
      publishStatus: "failed",
      outcome: "success",
      fetchedFundRows: 42,
      unknownField: "x",
    })
  );
  assert.equal(meta?.phase, "daily_sync");
  assert.equal(meta?.sourceStatus, "success");
  assert.equal(meta?.publishStatus, "failed");
  assert.equal(meta?.fetchedFundRows, 42);
  assert.equal((meta as Record<string, unknown>).unknownField, undefined);
});

test("parseDailySyncMetaWithLedgerFallback: v2 ledgeri legacy forma daraltır", () => {
  const meta = parseDailySyncMetaWithLedgerFallback(
    JSON.stringify({
      schemaVersion: "v2",
      phase: "daily_sync",
      runId: "daily-1",
      runKey: "2026-04-21",
      trigger: "cron",
      sourceFetch: { status: "success" },
      rawIngest: { status: "success" },
      normalizedSnapshot: { status: "success", effectiveDate: "2026-04-21T00:00:00.000Z" },
      servingPublish: { status: "success" },
      chartPublish: { status: "success", effectiveDate: "2026-04-21T00:00:00.000Z" },
      returnComparisonPublish: { status: "success", effectiveDate: "2026-04-21T00:00:00.000Z" },
      freshnessPublish: { status: "success" },
      finalStatus: "success",
      failureClass: "none",
      failureReason: null,
      counts: {
        fetchedFundRows: 10,
        writtenFundRows: 8,
        normalizedRows: 8,
        servingListRows: 8,
        servingDetailRows: 8,
        chartRows: 8,
        comparisonRows: 8,
      },
    })
  );
  assert.equal(meta?.sourceStatus, "success");
  assert.equal(meta?.publishStatus, "success");
  assert.equal(meta?.processedSnapshotDate, "2026-04-21T00:00:00.000Z");
  assert.equal(meta?.publishListRows, 8);
});


import assert from "node:assert/strict";
import test from "node:test";
import { parseDailySyncRunMeta } from "@/lib/daily-sync-run-meta";

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


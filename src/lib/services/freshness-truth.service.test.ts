import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFreshnessTruth } from "@/lib/services/freshness-truth.service";

const NOW = Date.parse("2026-04-19T12:00:00.000Z");

test("evaluateFreshnessTruth: missed sync today degraded olarak işaretlenir", () => {
  const out = evaluateFreshnessTruth({
    nowMs: NOW,
    expectedDateKey: "2026-04-19",
    snapshotAsOf: "2026-04-19T08:00:00.000Z",
    rawSnapshotAsOf: "2026-04-19T08:00:00.000Z",
    servingSnapshotAsOf: "2026-04-19T08:00:00.000Z",
    latestSuccessfulSyncAt: "2026-04-18T22:00:00.000Z",
    lastDailySyncCompletedDateKey: "2026-04-18",
    sourceUnavailable: false,
    syncMetaMalformed: false,
  });
  assert.equal(out.dailySyncCompletedToday, false);
  assert.equal(out.degradedReason, "daily_sync_not_completed_today");
});

test("evaluateFreshnessTruth: serving raw'dan gerideyse ayrı reason döner", () => {
  const out = evaluateFreshnessTruth({
    nowMs: NOW,
    expectedDateKey: "2026-04-19",
    snapshotAsOf: "2026-04-19T08:00:00.000Z",
    rawSnapshotAsOf: "2026-04-19T08:00:00.000Z",
    servingSnapshotAsOf: "2026-04-18T08:00:00.000Z",
    latestSuccessfulSyncAt: "2026-04-19T07:00:00.000Z",
    lastDailySyncCompletedDateKey: "2026-04-19",
    sourceUnavailable: false,
    syncMetaMalformed: false,
  });
  assert.equal(out.servingLagDays, 1);
  assert.equal(out.degradedReason, "serving_lagging_raw");
});

test("evaluateFreshnessTruth: source unavailable stale reason ile karışmaz", () => {
  const out = evaluateFreshnessTruth({
    nowMs: NOW,
    expectedDateKey: "2026-04-19",
    snapshotAsOf: null,
    rawSnapshotAsOf: null,
    servingSnapshotAsOf: null,
    latestSuccessfulSyncAt: null,
    lastDailySyncCompletedDateKey: null,
    sourceUnavailable: true,
    syncMetaMalformed: false,
  });
  assert.equal(out.sourceUnavailable, true);
  assert.equal(out.degradedReason, "source_unavailable");
});

test("evaluateFreshnessTruth: malformed sync meta explicit degraded reason döner", () => {
  const out = evaluateFreshnessTruth({
    nowMs: NOW,
    expectedDateKey: "2026-04-19",
    snapshotAsOf: "2026-04-19T08:00:00.000Z",
    rawSnapshotAsOf: "2026-04-19T08:00:00.000Z",
    servingSnapshotAsOf: "2026-04-19T08:00:00.000Z",
    latestSuccessfulSyncAt: null,
    lastDailySyncCompletedDateKey: "2026-04-19",
    sourceUnavailable: false,
    syncMetaMalformed: true,
  });
  assert.equal(out.degradedReason, "sync_meta_malformed");
});


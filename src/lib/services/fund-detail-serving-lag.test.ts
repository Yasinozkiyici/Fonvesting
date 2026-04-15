import test from "node:test";
import assert from "node:assert/strict";
import { shouldDropServingRowForUniverseLag } from "@/lib/services/fund-detail-serving-lag";

const DAY_MS = 86400000;
const BASE = Date.UTC(2026, 3, 15, 0, 0, 0, 0);

test("0-day lag keeps serving payload eligible", () => {
  const decision = shouldDropServingRowForUniverseLag({
    rowSnapshotMs: BASE,
    universeSnapshotMs: BASE,
    maxLagDays: 7,
  });
  assert.equal(decision.lagDays, 0);
  assert.equal(decision.rowBehindUniverse, false);
  assert.equal(decision.shouldDrop, false);
});

test("1-day lag keeps serving payload eligible", () => {
  const decision = shouldDropServingRowForUniverseLag({
    rowSnapshotMs: BASE - DAY_MS,
    universeSnapshotMs: BASE,
    maxLagDays: 7,
  });
  assert.equal(decision.lagDays, 1);
  assert.equal(decision.rowBehindUniverse, true);
  assert.equal(decision.shouldDrop, false);
});

test("exactly max tolerance keeps serving payload eligible", () => {
  const decision = shouldDropServingRowForUniverseLag({
    rowSnapshotMs: BASE - 7 * DAY_MS,
    universeSnapshotMs: BASE,
    maxLagDays: 7,
  });
  assert.equal(decision.lagDays, 7);
  assert.equal(decision.rowBehindUniverse, true);
  assert.equal(decision.shouldDrop, false);
});

test("beyond max tolerance drops serving payload", () => {
  const decision = shouldDropServingRowForUniverseLag({
    rowSnapshotMs: BASE - 8 * DAY_MS,
    universeSnapshotMs: BASE,
    maxLagDays: 7,
  });
  assert.equal(decision.lagDays, 8);
  assert.equal(decision.rowBehindUniverse, true);
  assert.equal(decision.shouldDrop, true);
});

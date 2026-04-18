import test from "node:test";
import assert from "node:assert/strict";
import { deriveFreshnessContract } from "@/lib/freshness-contract";

test("deriveFreshnessContract marks payload fresh within fresh TTL", () => {
  const nowMs = Date.parse("2026-04-18T12:00:00.000Z");
  const asOf = "2026-04-18T11:00:00.000Z";
  const result = deriveFreshnessContract({
    asOf,
    freshTtlMs: 2 * 60 * 60_000,
    staleTtlMs: 10 * 60 * 60_000,
    nowMs,
  });
  assert.equal(result.state, "fresh");
  assert.equal(result.reason, "within_fresh_ttl");
});

test("deriveFreshnessContract marks stale_ok between thresholds", () => {
  const nowMs = Date.parse("2026-04-18T12:00:00.000Z");
  const asOf = "2026-04-18T07:00:00.000Z";
  const result = deriveFreshnessContract({
    asOf,
    freshTtlMs: 2 * 60 * 60_000,
    staleTtlMs: 8 * 60 * 60_000,
    nowMs,
  });
  assert.equal(result.state, "stale_ok");
  assert.equal(result.reason, "within_stale_ttl");
});

test("deriveFreshnessContract marks degraded_outdated after stale TTL", () => {
  const nowMs = Date.parse("2026-04-18T12:00:00.000Z");
  const asOf = "2026-04-17T12:00:00.000Z";
  const result = deriveFreshnessContract({
    asOf,
    freshTtlMs: 2 * 60 * 60_000,
    staleTtlMs: 8 * 60 * 60_000,
    nowMs,
  });
  assert.equal(result.state, "degraded_outdated");
  assert.equal(result.reason, "beyond_stale_ttl");
});

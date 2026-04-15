import test from "node:test";
import assert from "node:assert/strict";
import { shouldStopBootstrapRetries } from "@/lib/scored-funds-bootstrap";

test("retry stops strictly at max attempts", () => {
  assert.equal(shouldStopBootstrapRetries(0, 3), false);
  assert.equal(shouldStopBootstrapRetries(1, 3), false);
  assert.equal(shouldStopBootstrapRetries(2, 3), false);
  assert.equal(shouldStopBootstrapRetries(3, 3), true);
  assert.equal(shouldStopBootstrapRetries(4, 3), true);
});

test("no rows after retry ceiling exits skeleton mode deterministically", () => {
  const shouldStop = shouldStopBootstrapRetries(3, 3);
  const loading = false;
  const bootstrapFallbackActive = !shouldStop;
  const rows = 0;
  const showSkeleton = (loading || bootstrapFallbackActive) && rows === 0;
  assert.equal(showSkeleton, false);
});

test("resolved degraded empty state remains deterministic", () => {
  const shouldStop = shouldStopBootstrapRetries(3, 3);
  const hasRows = false;
  const hasError = false;
  const hasDegradedNotice = true;
  const resolvedDegradedEmpty = shouldStop && !hasRows && !hasError && hasDegradedNotice;
  assert.equal(resolvedDegradedEmpty, true);
});

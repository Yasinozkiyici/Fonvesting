import test from "node:test";
import assert from "node:assert/strict";
import { resolveHealthDbFailureCategory } from "./health-db-diagnostics";

test("health diagnostic classification prefers env misconfiguration", () => {
  const category = resolveHealthDbFailureCategory({
    envFailureCategory: "missing_database_url",
    probeFailureCategory: "network_unreachable",
    classifiedFailureCategory: "unknown",
  });
  assert.equal(category, "missing_database_url");
});

test("health diagnostic classification falls back to probe failure", () => {
  const category = resolveHealthDbFailureCategory({
    envFailureCategory: null,
    probeFailureCategory: "connect_timeout",
    classifiedFailureCategory: "unknown",
  });
  assert.equal(category, "connect_timeout");
});

test("health diagnostic classification uses classified failure when needed", () => {
  const category = resolveHealthDbFailureCategory({
    envFailureCategory: null,
    probeFailureCategory: null,
    classifiedFailureCategory: "auth_failed",
  });
  assert.equal(category, "auth_failed");
});


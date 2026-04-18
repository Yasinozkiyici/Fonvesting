import test from "node:test";
import assert from "node:assert/strict";
import { computeServingBuildId } from "@/lib/domain/serving/build-id";

test("computeServingBuildId is deterministic", () => {
  const a = computeServingBuildId({
    snapshotAsOfIso: "2026-04-17T00:00:00.000Z",
    gitCommitShort: "abc",
    pipelineRunKey: "run-1",
  });
  const b = computeServingBuildId({
    snapshotAsOfIso: "2026-04-17T00:00:00.000Z",
    gitCommitShort: "abc",
    pipelineRunKey: "run-1",
  });
  assert.equal(a, b);
});

test("computeServingBuildId changes when snapshot changes", () => {
  const a = computeServingBuildId({
    snapshotAsOfIso: "2026-04-16T00:00:00.000Z",
    gitCommitShort: "abc",
    pipelineRunKey: "run-1",
  });
  const b = computeServingBuildId({
    snapshotAsOfIso: "2026-04-17T00:00:00.000Z",
    gitCommitShort: "abc",
    pipelineRunKey: "run-1",
  });
  assert.notEqual(a, b);
});

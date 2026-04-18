import test from "node:test";
import assert from "node:assert/strict";
import { classifyDailySourceQuality } from "@/lib/pipeline/daily-run-classification";

test("classifies true no-op day", () => {
  const result = classifyDailySourceQuality({
    historyOk: true,
    macroOk: true,
    fetchedRows: 1200,
    writtenRows: 0,
  });
  assert.equal(result.kind, "successful_noop");
});

test("classifies empty source anomaly", () => {
  const result = classifyDailySourceQuality({
    historyOk: true,
    macroOk: true,
    fetchedRows: 0,
    writtenRows: 0,
  });
  assert.equal(result.kind, "empty_source_anomaly");
});

test("classifies partial source failure", () => {
  const result = classifyDailySourceQuality({
    historyOk: false,
    macroOk: true,
    fetchedRows: 50,
    writtenRows: 10,
  });
  assert.equal(result.kind, "partial_source_failure");
});

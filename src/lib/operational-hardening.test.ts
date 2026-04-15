import test from "node:test";
import assert from "node:assert/strict";
import {
  filterExpectedHealthDiagnosticErrors,
  hasUsableCompareRows,
  healthDbPingFailureLogLevel,
  optionalReferenceDegradation,
  shouldUseFastCompareContextFallback,
} from "@/lib/operational-hardening";

test("compare guard rejects empty or product-useless 200 payloads", () => {
  assert.equal(hasUsableCompareRows([]), false);
  assert.equal(hasUsableCompareRows([{ code: "", name: "VGA", lastPrice: 1 }]), false);
  assert.equal(hasUsableCompareRows([{ code: "VGA", name: "", lastPrice: Number.NaN }]), false);
  assert.equal(hasUsableCompareRows([{ code: "VGA", name: "Fon", lastPrice: 0 }]), true);
});

test("serving-backed compare rows use fast optional context fallback", () => {
  assert.equal(
    shouldUseFastCompareContextFallback([
      { code: "VGA", name: "Fon", lastPrice: 1, fallbackOnly: true },
      { code: "TI1", name: "Fon", lastPrice: 2, fallbackOnly: true },
    ]),
    true
  );
  assert.equal(
    shouldUseFastCompareContextFallback([
      { code: "VGA", name: "Fon", lastPrice: 1 },
      { code: "TI1", name: "Fon", lastPrice: 2 },
    ]),
    false
  );
});

test("macro and category reference failures are classified as optional degradation", () => {
  assert.deepEqual(optionalReferenceDegradation("macro", { timeout: true }), {
    degradedSource: "macro_optional",
    failureClass: "optional_timeout",
  });
  assert.deepEqual(optionalReferenceDegradation("category_universe", { timeout: false }), {
    degradedSource: "category_universe_optional",
    failureClass: "optional_failed",
  });
});

test("direct DB diagnostic timeout does not become an error log when read path is operational", () => {
  assert.equal(
    healthDbPingFailureLogLevel({ readPathOperational: true, failureCategory: "health_probe_soft_timeout" }),
    "info"
  );
  assert.equal(healthDbPingFailureLogLevel({ readPathOperational: false, failureCategory: "connect_timeout" }), "error");
});

test("expected direct DB diagnostic errors are filtered when user-critical read path works", () => {
  const errors = ["database_ping: health_db_ping_soft_timeout_3000ms", "rest_freshness: timeout"];
  assert.deepEqual(filterExpectedHealthDiagnosticErrors({ errors, readPathOperational: true }), [
    "rest_freshness: timeout",
  ]);
  assert.deepEqual(filterExpectedHealthDiagnosticErrors({ errors, readPathOperational: false }), errors);
});

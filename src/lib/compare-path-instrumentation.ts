import { randomUUID } from "node:crypto";

/**
 * Request-level tracing for /api/funds/compare and /api/funds/compare-series only.
 * Emits one JSON line per request (server logs) and compact, non-PII response headers.
 */
export type ComparePathRoute = "compare" | "compare-series";

export type ComparePathStepOutcome = "ok" | "timeout" | "error" | "empty" | "skipped" | "degraded";

export type ComparePathStepRecord = {
  step: string;
  ms: number;
  outcome: ComparePathStepOutcome;
  detail?: string;
};

export type ComparePathTrace = {
  readonly id: string;
  readonly route: ComparePathRoute;
  record(step: string, ms: number, outcome: ComparePathStepOutcome, detail?: string): void;
  /**
   * Log structured trace and return safe response headers (call once per request).
   */
  finish(input: {
    httpStatus: number;
    classification: string;
    failureClass?: string | null;
    rowSource?: string | null;
    detailSource?: string | null;
  }): Record<string, string>;
};

const MAX_STEP_HEADER_LEN = 900;

export function createComparePathTrace(route: ComparePathRoute): ComparePathTrace {
  const id = randomUUID();
  const t0 = performance.now();
  const steps: ComparePathStepRecord[] = [];

  return {
    id,
    route,
    record(step, ms, outcome, detail) {
      const rec: ComparePathStepRecord = { step, ms, outcome };
      if (detail) rec.detail = detail.slice(0, 120);
      steps.push(rec);
    },
    finish(input) {
      const totalMs = Math.round(performance.now() - t0);
      const stepSummary = steps
        .map((s) => `${s.step}:${s.ms}:${s.outcome}${s.detail ? `:${s.detail}` : ""}`)
        .join("|")
        .slice(0, MAX_STEP_HEADER_LEN);
      const payload = {
        comparePathTrace: true,
        id,
        route,
        totalMs,
        httpStatus: input.httpStatus,
        classification: input.classification,
        failureClass: input.failureClass ?? null,
        rowSource: input.rowSource ?? null,
        detailSource: input.detailSource ?? null,
        steps,
      };
      console.log(JSON.stringify(payload));
      return {
        "X-Compare-Path-Trace-Id": id,
        "X-Compare-Path-Total-Ms": String(totalMs),
        "X-Compare-Path-Classification": input.classification,
        ...(stepSummary ? { "X-Compare-Path-Steps": stepSummary } : {}),
      };
    },
  };
}

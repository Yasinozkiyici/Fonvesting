/**
 * Yalnızca /api/funds/scores için istek içi süre özeti (504 kök nedeni ayıklama).
 */

export type ScoresRouteTraceStep = { name: string; ms: number; note?: string };

export class ScoresRouteTrace {
  readonly traceId: string;
  readonly startedAt: number;
  private lastAt: number;
  readonly steps: ScoresRouteTraceStep[] = [];
  servingBundleTimeout = false;
  outcome: string | null = null;
  source: string | null = null;

  constructor(traceId: string) {
    this.traceId = traceId;
    this.startedAt = Date.now();
    this.lastAt = this.startedAt;
  }

  mark(name: string, note?: string): void {
    const now = Date.now();
    this.steps.push({ name, ms: now - this.lastAt, ...(note ? { note } : {}) });
    this.lastAt = now;
  }

  totalMs(): number {
    return Date.now() - this.startedAt;
  }

  toStepsHeader(): string {
    return this.steps.map((s) => `${s.name}:${s.ms}${s.note ? `:${s.note}` : ""}`).join("|");
  }

  logJson(extra: Record<string, unknown>): void {
    console.info(
      "[scores-api-trace]",
      JSON.stringify({
        traceId: this.traceId,
        totalMs: this.totalMs(),
        servingBundleTimeout: this.servingBundleTimeout,
        outcome: this.outcome,
        source: this.source,
        steps: this.steps,
        ...extra,
      })
    );
  }
}

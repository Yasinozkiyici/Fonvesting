export type FreshnessState = "fresh" | "stale_ok" | "degraded_outdated";

export type FreshnessContract = {
  state: FreshnessState;
  asOf: string | null;
  ageMs: number | null;
  reason: "within_fresh_ttl" | "within_stale_ttl" | "beyond_stale_ttl" | "asof_unknown";
};

type FreshnessInput = {
  asOf: string | null | undefined;
  freshTtlMs: number;
  staleTtlMs: number;
  nowMs?: number;
  unknownAsDegraded?: boolean;
};

function parseAsOfMs(asOf: string | null | undefined): number | null {
  if (!asOf) return null;
  const ms = Date.parse(asOf);
  return Number.isFinite(ms) ? ms : null;
}

export function deriveFreshnessContract(input: FreshnessInput): FreshnessContract {
  const asOfMs = parseAsOfMs(input.asOf);
  if (!asOfMs) {
    return {
      state: input.unknownAsDegraded === false ? "stale_ok" : "degraded_outdated",
      asOf: null,
      ageMs: null,
      reason: "asof_unknown",
    };
  }
  const nowMs = input.nowMs ?? Date.now();
  const ageMs = Math.max(0, nowMs - asOfMs);
  if (ageMs <= input.freshTtlMs) {
    return { state: "fresh", asOf: new Date(asOfMs).toISOString(), ageMs, reason: "within_fresh_ttl" };
  }
  if (ageMs <= input.staleTtlMs) {
    return { state: "stale_ok", asOf: new Date(asOfMs).toISOString(), ageMs, reason: "within_stale_ttl" };
  }
  return { state: "degraded_outdated", asOf: new Date(asOfMs).toISOString(), ageMs, reason: "beyond_stale_ttl" };
}

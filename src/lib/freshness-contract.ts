export type FreshnessState = "fresh" | "stale_ok" | "degraded_outdated";

/** TTL tabanlı türetim — `deriveFreshnessContract` çıktısı. */
export type FreshnessContract = {
  state: FreshnessState;
  asOf: string | null;
  ageMs: number | null;
  reason: "within_fresh_ttl" | "within_stale_ttl" | "beyond_stale_ttl" | "asof_unknown";
};

/**
 * Ürün genelinde tek taze veri sözleşmesi (Faz 5’te sync alanları doldurulur).
 * API meta ve sağlık yüzeyleri `toCanonicalFreshnessContract` ile üretir.
 */
export type CanonicalFreshnessContract = {
  snapshotAsOf: string | null;
  latestSuccessfulSyncAt: string | null;
  staleByDays: number | null;
  staleByHours: number | null;
  freshnessStatus: FreshnessState;
  source: string;
  degradedReason: string | null;
  ageMs: number | null;
  ttlReason: FreshnessContract["reason"];
};

export function toCanonicalFreshnessContract(
  base: FreshnessContract,
  source: string,
  opts?: { latestSuccessfulSyncAt?: string | null; degradedReason?: string | null }
): CanonicalFreshnessContract {
  const staleByHours =
    base.ageMs != null && Number.isFinite(base.ageMs) ? base.ageMs / 3_600_000 : null;
  const staleByDays = staleByHours != null ? staleByHours / 24 : null;
  return {
    snapshotAsOf: base.asOf,
    latestSuccessfulSyncAt: opts?.latestSuccessfulSyncAt ?? null,
    staleByDays,
    staleByHours,
    freshnessStatus: base.state,
    source,
    degradedReason:
      opts?.degradedReason ??
      (base.state === "degraded_outdated" ? base.reason : null),
    ageMs: base.ageMs,
    ttlReason: base.reason,
  };
}

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

export type FundDataReliabilityClass = "current" | "stale_but_usable" | "degraded" | "invalid_insufficient";

export type ReliabilitySourceTier = "canonical" | "serving" | "snapshot" | "fallback";
export type FreshnessClass = "fresh" | "stale" | "unknown";
export type DegradeClass = "none" | "soft" | "hard";
export type HealthState = "healthy" | "degraded" | "invalid";
export type HorizonValidityClass = "valid" | "too_short" | "stale_locked";

export type ReliabilityDecision = {
  class: FundDataReliabilityClass;
  canPresentAsTrustedFinalState: boolean;
  sourceTier: ReliabilitySourceTier;
  freshnessClass: FreshnessClass;
  degradeClass: DegradeClass;
  reasons: string[];
};

export type DetailReliabilityInput = {
  sourceTier: ReliabilitySourceTier;
  hasCoreSeries: boolean;
  hasTrendSeries: boolean;
  hasComparison: boolean;
  hasMeaningfulAlternatives: boolean;
  stale: boolean;
  partial: boolean;
  reasons: string[];
  failedSteps: string[];
};

export type DiscoveryReliabilityInput = {
  sourceTier: ReliabilitySourceTier;
  stale: boolean;
  rows: number;
  total: number;
  scopeAligned: boolean;
  degradedReason: string | null;
  failureClass: string | null;
};

function normalizeReasons(reasons: string[]): string[] {
  return [...new Set(reasons.map((item) => item.trim()).filter(Boolean))];
}

function buildFreshnessClass(stale: boolean): FreshnessClass {
  return stale ? "stale" : "fresh";
}

function buildDegradeClass(decisionClass: FundDataReliabilityClass): DegradeClass {
  if (decisionClass === "current" || decisionClass === "stale_but_usable") return "none";
  if (decisionClass === "degraded") return "soft";
  return "hard";
}

export function evaluateDetailReliability(input: DetailReliabilityInput): ReliabilityDecision {
  const reasons = normalizeReasons(input.reasons);
  const structuralMissing =
    !input.hasCoreSeries || !input.hasTrendSeries || !input.hasComparison || !input.hasMeaningfulAlternatives;
  const hardFailure = input.failedSteps.length > 0;

  if (hardFailure || structuralMissing) {
    return {
      class: "invalid_insufficient",
      canPresentAsTrustedFinalState: false,
      sourceTier: input.sourceTier,
      freshnessClass: buildFreshnessClass(input.stale),
      degradeClass: "hard",
      reasons: normalizeReasons([
        ...reasons,
        ...(hardFailure ? ["failed_steps_present"] : []),
        ...(!input.hasCoreSeries ? ["main_series_insufficient"] : []),
        ...(!input.hasTrendSeries ? ["trend_series_insufficient"] : []),
        ...(!input.hasComparison ? ["comparison_semantically_empty"] : []),
        ...(!input.hasMeaningfulAlternatives ? ["alternatives_not_actionable"] : []),
      ]),
    };
  }

  if (input.partial || reasons.length > 0) {
    return {
      class: input.stale ? "stale_but_usable" : "degraded",
      canPresentAsTrustedFinalState: false,
      sourceTier: input.sourceTier,
      freshnessClass: buildFreshnessClass(input.stale),
      degradeClass: input.stale ? "none" : "soft",
      reasons,
    };
  }

  if (input.stale) {
    return {
      class: "stale_but_usable",
      canPresentAsTrustedFinalState: false,
      sourceTier: input.sourceTier,
      freshnessClass: "stale",
      degradeClass: "none",
      reasons: reasons.length > 0 ? reasons : ["stale_snapshot_or_cache"],
    };
  }

  return {
    class: "current",
    canPresentAsTrustedFinalState: true,
    sourceTier: input.sourceTier,
    freshnessClass: "fresh",
    degradeClass: "none",
    reasons,
  };
}

export function evaluateDiscoveryReliability(input: DiscoveryReliabilityInput): ReliabilityDecision {
  const reasons = normalizeReasons([
    ...(input.degradedReason ? [input.degradedReason] : []),
    ...(input.failureClass ? [`failure_class:${input.failureClass}`] : []),
    ...(!input.scopeAligned ? ["scope_drift_detected"] : []),
  ]);

  if (!input.scopeAligned) {
    return {
      class: "invalid_insufficient",
      canPresentAsTrustedFinalState: false,
      sourceTier: input.sourceTier,
      freshnessClass: buildFreshnessClass(input.stale),
      degradeClass: "hard",
      reasons,
    };
  }

  if (input.rows === 0 && input.total > 0) {
    return {
      class: "invalid_insufficient",
      canPresentAsTrustedFinalState: false,
      sourceTier: input.sourceTier,
      freshnessClass: buildFreshnessClass(input.stale),
      degradeClass: "hard",
      reasons: normalizeReasons([...reasons, "visible_rows_zero_but_total_positive"]),
    };
  }

  if (reasons.length > 0) {
    return {
      class: input.stale ? "stale_but_usable" : "degraded",
      canPresentAsTrustedFinalState: false,
      sourceTier: input.sourceTier,
      freshnessClass: buildFreshnessClass(input.stale),
      degradeClass: input.stale ? "none" : "soft",
      reasons,
    };
  }

  if (input.stale) {
    return {
      class: "stale_but_usable",
      canPresentAsTrustedFinalState: false,
      sourceTier: input.sourceTier,
      freshnessClass: "stale",
      degradeClass: "none",
      reasons: ["stale_cache_or_snapshot"],
    };
  }

  return {
    class: "current",
    canPresentAsTrustedFinalState: true,
    sourceTier: input.sourceTier,
    freshnessClass: "fresh",
    degradeClass: "none",
    reasons,
  };
}

export function reliabilitySourceFromDetailReasons(reasons: string[]): ReliabilitySourceTier {
  if (reasons.some((reason) => reason.includes("live") || reason.includes("canonical"))) return "canonical";
  if (reasons.some((reason) => reason.includes("serving"))) return "serving";
  if (reasons.some((reason) => reason.includes("snapshot"))) return "snapshot";
  return "fallback";
}

export function reliabilitySourceFromDiscoverySource(source: string): ReliabilitySourceTier {
  if (source === "snapshot") return "canonical";
  if (source === "memory" || source === "stale") return "snapshot";
  if (source === "db-cache") return "serving";
  return "fallback";
}

export function healthFromReliabilityClass(value: FundDataReliabilityClass): HealthState {
  if (value === "current" || value === "stale_but_usable") return "healthy";
  if (value === "degraded") return "degraded";
  return "invalid";
}

export function horizonValidityFromSeries(points: number, minPoints: number, stale: boolean): HorizonValidityClass {
  if (stale) return "stale_locked";
  if (points < minPoints) return "too_short";
  return "valid";
}

export function normalizeReliabilityDecision(decision: ReliabilityDecision): ReliabilityDecision {
  return {
    ...decision,
    reasons: normalizeReasons(decision.reasons),
    degradeClass: decision.degradeClass ?? buildDegradeClass(decision.class),
    freshnessClass: decision.freshnessClass ?? "unknown",
  };
}

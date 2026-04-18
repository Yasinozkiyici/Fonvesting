import {
  evaluateDiscoveryReliability,
  healthFromReliabilityClass,
  normalizeReliabilityDecision,
  reliabilitySourceFromDiscoverySource,
  type FundDataReliabilityClass,
  type HealthState,
} from "@/lib/fund-data-reliability";
import type { ScoresApiPayload } from "@/lib/services/fund-scores-types";
import { fundMatchesTheme, type FundThemeId } from "@/lib/fund-themes";

export type DiscoveryHealth = {
  scopeHealth: HealthState;
  resultCompletenessHealth: HealthState;
  freshnessHealth: HealthState;
  requestConsistencyHealth: HealthState;
  overallDiscoveryHealth: HealthState;
  reliabilityClass: FundDataReliabilityClass;
  trustAsFinal: boolean;
  reasons: string[];
};

export type DiscoveryScope = {
  mode: string;
  categoryCode: string;
  theme: FundThemeId | null;
  queryTrim: string;
};

function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function matchedCoverageTotal(payload: ScoresApiPayload): number {
  return payload.matchedTotal ?? payload.total;
}

function isScopeAligned(payload: ScoresApiPayload, scope: DiscoveryScope): boolean {
  if (matchedCoverageTotal(payload) < payload.funds.length) return false;
  const normalizedQuery = normalizeQuery(scope.queryTrim);
  return payload.funds.every((fund) => {
    if (scope.categoryCode && fund.category?.code !== scope.categoryCode) return false;
    if (scope.theme && !fundMatchesTheme(fund, scope.theme)) return false;
    if (normalizedQuery) {
      const text = `${fund.code} ${fund.name} ${fund.shortName ?? ""}`.toLocaleLowerCase("tr-TR");
      if (!text.includes(normalizedQuery)) return false;
    }
    return true;
  });
}

function rollupHealth(values: HealthState[]): HealthState {
  if (values.some((item) => item === "invalid")) return "invalid";
  if (values.some((item) => item === "degraded")) return "degraded";
  return "healthy";
}

export function deriveDiscoveryHealth(input: {
  payload: ScoresApiPayload;
  scope: DiscoveryScope;
  source: string;
  degradedReason: string | null;
  failureClass: string | null;
  stale: boolean;
  requestConsistent: boolean;
}): DiscoveryHealth {
  const scopeAligned = isScopeAligned(input.payload, input.scope);
  const decision = normalizeReliabilityDecision(
    evaluateDiscoveryReliability({
      sourceTier: reliabilitySourceFromDiscoverySource(input.source),
      stale: input.stale,
      rows: input.payload.funds.length,
      total: matchedCoverageTotal(input.payload),
      scopeAligned,
      degradedReason: input.degradedReason,
      failureClass: input.failureClass,
    })
  );
  const scopeHealth = healthFromReliabilityClass(scopeAligned ? "current" : "invalid_insufficient");
  const resultCompletenessHealth = healthFromReliabilityClass(
    matchedCoverageTotal(input.payload) >= input.payload.funds.length ? "current" : "invalid_insufficient"
  );
  const freshnessHealth = healthFromReliabilityClass(input.stale ? "stale_but_usable" : "current");
  const requestConsistencyHealth = healthFromReliabilityClass(
    input.requestConsistent ? "current" : "invalid_insufficient"
  );
  const overallDiscoveryHealth = rollupHealth([
    scopeHealth,
    resultCompletenessHealth,
    freshnessHealth,
    requestConsistencyHealth,
    healthFromReliabilityClass(decision.class),
  ]);
  return {
    scopeHealth,
    resultCompletenessHealth,
    freshnessHealth,
    requestConsistencyHealth,
    overallDiscoveryHealth,
    reliabilityClass: decision.class,
    trustAsFinal: decision.canPresentAsTrustedFinalState && overallDiscoveryHealth === "healthy",
    reasons: decision.reasons,
  };
}

import type { FreshnessContract } from "@/lib/freshness-contract";
import type { FundKiyasViewPayload } from "@/lib/services/fund-detail-kiyas.service";

export type FundDetailComparisonState =
  | "loading"
  | "ready"
  | "no_comparable_refs"
  | "degraded_timeout"
  | "source_unavailable"
  | "error";

export type FundDetailComparisonRenderReason =
  | "comparison_ready"
  | "no_comparable_refs"
  | "degraded_timeout"
  | "source_unavailable"
  | "error";

export type FundDetailComparisonRenderContract = {
  renderable: boolean;
  reason: FundDetailComparisonRenderReason;
  attemptedRefs: number;
  validRefs: number;
  degraded: boolean;
  freshness: FreshnessContract | null;
};

export type FundDetailComparisonPayload = {
  code: string;
  state: FundDetailComparisonState;
  contract: FundDetailComparisonRenderContract;
  block: FundKiyasViewPayload | null;
  degradedReason: string | null;
  generatedAt: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function deriveFundDetailComparisonContract(input: {
  state: FundDetailComparisonState;
  block: FundKiyasViewPayload | null;
  freshness: FreshnessContract | null;
  degradedReason: string | null;
}): FundDetailComparisonRenderContract {
  const attemptedRefs = input.block?.refs?.length ?? 0;
  let validRefs = 0;
  const rowsByRef = input.block?.rowsByRef ?? null;
  if (rowsByRef) {
    for (const rows of Object.values(rowsByRef)) {
      if (!rows?.length) continue;
      if (rows.some((r) => isFiniteNumber(r?.fundPct) && isFiniteNumber(r?.refPct))) {
        validRefs += 1;
      }
    }
  }
  const degraded = input.state !== "ready";
  if (input.state === "ready" && input.block) {
    return {
      renderable: true,
      reason: "comparison_ready",
      attemptedRefs,
      validRefs,
      degraded: false,
      freshness: input.freshness,
    };
  }
  if (input.state === "no_comparable_refs") {
    return {
      renderable: false,
      reason: "no_comparable_refs",
      attemptedRefs,
      validRefs,
      degraded,
      freshness: input.freshness,
    };
  }
  if (input.state === "degraded_timeout") {
    return {
      renderable: false,
      reason: "degraded_timeout",
      attemptedRefs,
      validRefs,
      degraded,
      freshness: input.freshness,
    };
  }
  if (input.state === "source_unavailable") {
    return {
      renderable: false,
      reason: "source_unavailable",
      attemptedRefs,
      validRefs,
      degraded,
      freshness: input.freshness,
    };
  }
  return {
    renderable: false,
    reason: "error",
    attemptedRefs,
    validRefs,
    degraded,
    freshness: input.freshness,
  };
}


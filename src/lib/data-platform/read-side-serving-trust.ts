import type { UiServingWorldMeta } from "@/lib/domain/serving/ui-cutover-contract";

export type ServingReadDegradedKind =
  | "none"
  | "serving_world_missing"
  | "serving_world_misaligned"
  | "serving_payload_missing"
  | "serving_payload_invalid"
  | "legacy_fallback";

export type ServingReadTrust = {
  trustAsFinal: boolean;
  degradedKind: ServingReadDegradedKind;
  degradedReason: string | null;
};

export type ServingRouteSource =
  | "serving_fund_list"
  | "serving_discovery_index"
  | "serving_compare_inputs"
  | "serving_system_status"
  | "legacy_fallback"
  | "unknown";

export function enforceServingRouteTrust(input: {
  world: UiServingWorldMeta | null;
  source: ServingRouteSource;
  requiredBuilds: Array<keyof UiServingWorldMeta["buildIds"]>;
  payloadAvailable: boolean;
  fallbackUsed: boolean;
  fallbackReason?: string | null;
}): ServingReadTrust {
  if (!input.world?.worldId) {
    return {
      trustAsFinal: false,
      degradedKind: "serving_world_missing",
      degradedReason: input.fallbackReason ?? "world_id_missing",
    };
  }
  if (!input.world.worldAligned) {
    return {
      trustAsFinal: false,
      degradedKind: "serving_world_misaligned",
      degradedReason: input.fallbackReason ?? "build_world_misaligned",
    };
  }
  const missingRequired = input.requiredBuilds.find((key) => !input.world?.buildIds[key]);
  if (missingRequired) {
    return {
      trustAsFinal: false,
      degradedKind: "serving_payload_missing",
      degradedReason: input.fallbackReason ?? `missing_build_head:${missingRequired}`,
    };
  }
  if (!input.payloadAvailable) {
    return {
      trustAsFinal: false,
      degradedKind: "serving_payload_missing",
      degradedReason: input.fallbackReason ?? `payload_missing:${input.source}`,
    };
  }
  if (input.fallbackUsed) {
    return {
      trustAsFinal: false,
      degradedKind: "legacy_fallback",
      degradedReason: input.fallbackReason ?? "legacy_fallback",
    };
  }
  return { trustAsFinal: true, degradedKind: "none", degradedReason: null };
}

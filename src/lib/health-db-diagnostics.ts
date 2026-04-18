import type { DbEnvFailureCategory } from "@/lib/db-env-validation";

type DbRuntimeFailureCategory =
  | "pool_checkout_timeout"
  | "query_execution_timeout"
  | "transaction_timeout"
  | "connection_closed"
  | "connect_timeout"
  | "network_unreachable"
  | "invalid_datasource"
  | "auth_failed"
  | "unknown"
  | "health_probe_soft_timeout";

export type HealthDbFailureCategory = DbEnvFailureCategory | DbRuntimeFailureCategory | null;

export function resolveHealthDbFailureCategory(input: {
  envFailureCategory: DbEnvFailureCategory | null;
  probeFailureCategory: string | null;
  classifiedFailureCategory: DbRuntimeFailureCategory;
}): HealthDbFailureCategory {
  if (input.envFailureCategory) return input.envFailureCategory;
  if (input.probeFailureCategory) return input.probeFailureCategory as HealthDbFailureCategory;
  return input.classifiedFailureCategory;
}


export type CompareHardeningRow = {
  code: string;
  name?: string | null;
  lastPrice?: number | null;
  fallbackOnly?: boolean;
};

export function hasUsableCompareRows(rows: CompareHardeningRow[]): boolean {
  return (
    rows.length > 0 &&
    rows.every((row) => {
      const code = row.code.trim();
      const name = row.name?.trim() ?? code;
      const price = row.lastPrice;
      return code.length > 0 && name.length > 0 && typeof price === "number" && Number.isFinite(price);
    })
  );
}

export function shouldUseFastCompareContextFallback(rows: CompareHardeningRow[]): boolean {
  return hasUsableCompareRows(rows) && rows.some((row) => row.fallbackOnly === true);
}

export function optionalReferenceDegradation(
  source: "macro" | "category_universe",
  input: { timeout: boolean }
): { degradedSource: string; failureClass: string } {
  return {
    degradedSource: `${source}_optional`,
    failureClass: input.timeout ? "optional_timeout" : "optional_failed",
  };
}

export function filterExpectedHealthDiagnosticErrors(input: {
  errors: string[];
  readPathOperational: boolean;
}): string[] {
  if (!input.readPathOperational) return input.errors;
  return input.errors.filter((error) => !error.startsWith("database_ping:"));
}

export function healthDbPingFailureLogLevel(input: {
  readPathOperational: boolean;
  failureCategory: string | null;
}): "info" | "error" {
  if (input.readPathOperational) return "info";
  return "error";
}

export function detailEnrichmentDbFailureLogLevel(input: {
  shellUsable: boolean;
  step: string;
}): "warn" | "error" {
  if (
    input.shellUsable &&
    (input.step === "price_history_query" || input.step === "core_meta_bundle_query")
  ) {
    return "warn";
  }
  return "error";
}

export function resolveHealthDbPingSoftBudgetMs(input: {
  lightweight: boolean;
  defaultSoftBudgetMs: number;
  lightSoftBudgetMs: number;
}): number {
  const fallback = Math.max(300, Math.trunc(input.defaultSoftBudgetMs));
  if (!input.lightweight) return fallback;
  const light = Math.trunc(input.lightSoftBudgetMs);
  if (!Number.isFinite(light)) return Math.min(fallback, 900);
  return Math.max(250, Math.min(fallback, light));
}

export function shouldRunExternalDbFailureProbes(input: {
  includeExternalProbes: boolean;
  lightweight: boolean;
}): boolean {
  return input.includeExternalProbes || !input.lightweight;
}

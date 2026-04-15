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

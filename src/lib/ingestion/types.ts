export type IngestionSourceId = "tefas_browser" | "macro_open_data" | "manual" | string;

export type RawInsertPlan = {
  source: IngestionSourceId;
  sourceKey: string;
  effectiveDate: Date | null;
  payload: unknown;
  checksum: string;
  parseStatus?: "PENDING" | "OK" | "FAILED";
  parseError?: string | null;
};

export type ParseOutcome =
  | { ok: true; parseStatus: "OK" }
  | { ok: false; parseStatus: "FAILED"; error: string };

export type AdapterFetchResult = {
  plans: RawInsertPlan[];
  diagnostics: Record<string, unknown>;
};

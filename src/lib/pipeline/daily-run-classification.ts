export type DailySourceQualityKind =
  | "success_with_data"
  | "successful_noop"
  | "empty_source_anomaly"
  | "partial_source_failure";

export function classifyDailySourceQuality(input: {
  historyOk: boolean;
  macroOk: boolean;
  fetchedRows: number;
  writtenRows: number;
}): { kind: DailySourceQualityKind; reason: string } {
  if (!input.historyOk || !input.macroOk) {
    return { kind: "partial_source_failure", reason: "history_or_macro_not_ok" };
  }
  if (input.fetchedRows === 0 && input.writtenRows === 0) {
    return { kind: "empty_source_anomaly", reason: "history_fetched_and_written_zero" };
  }
  if (input.writtenRows === 0) {
    return { kind: "successful_noop", reason: "source_data_already_applied_idempotent" };
  }
  return { kind: "success_with_data", reason: "source_rows_fetched_and_written" };
}

import { getSystemHealthSnapshot } from "@/lib/system-health";

export type DiagnosticsSnapshot = {
  fundCount: number;
  macroSeriesCount: number;
  macroObservationCount: number;
  macroLatestDate: string | null;
  macroSyncStatus: string | null;
  err: string | null;
  dbUrlPreview: string;
  effectiveDbUrlPreview: string;
};

export async function getDiagnosticsSnapshot(): Promise<DiagnosticsSnapshot> {
  const snapshot = await getSystemHealthSnapshot({ includeExternalProbes: true });

  return {
    fundCount: snapshot.counts.funds,
    macroSeriesCount: snapshot.counts.macroSeries,
    macroObservationCount: snapshot.counts.macroObservations,
    macroLatestDate: snapshot.freshness.latestMacroObservationDate,
    macroSyncStatus: snapshot.integrity.macroSyncStatus,
    err: snapshot.errors[0] ?? null,
    dbUrlPreview: snapshot.database.dbUrlPreview,
    effectiveDbUrlPreview: snapshot.database.effectiveDbUrlPreview,
  };
}

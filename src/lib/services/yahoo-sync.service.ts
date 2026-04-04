export type YahooSyncStats = {
  ok: boolean;
  liveSymbolsCount: number;
  skipped?: boolean;
  message?: string;
};

/** BIST senkronu kaldırıldı; TEFAS için `runTefasSync` kullanın. */
export async function syncYahooStocksIfStale(_options?: { force?: boolean }): Promise<YahooSyncStats> {
  return { ok: true, liveSymbolsCount: 0, skipped: true, message: "bist_sync_disabled" };
}

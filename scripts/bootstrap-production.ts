import "./load-env";
import { prisma } from "../src/lib/prisma";
import { refreshMacroSyncState, recoverStaleMacroSyncState, syncMacroSeriesRange } from "../src/lib/services/macro-series.service";
import { rebuildFundDailySnapshots } from "../src/lib/services/fund-daily-snapshot.service";
import { rebuildFundDerivedMetrics } from "../src/lib/services/fund-derived-metrics.service";
import { rebuildFundDetailCoreServingCache } from "../src/lib/services/fund-detail-core-serving.service";
import { warmAllScoresApiCaches } from "../src/lib/services/fund-scores-cache.service";
import {
  backfillFundHistoryDays,
  recoverStaleHistorySyncState,
  refreshFundHistorySyncState,
} from "../src/lib/services/tefas-history.service";
import { rebuildMarketSnapshot, recomputeFundReturnsFromHistory, runFullTefasSync } from "../src/lib/services/tefas-sync.service";
import { startOfUtcDay } from "../src/lib/trading-calendar-tr";

const databaseUrlFromShell = process.env.DATABASE_URL;
const directUrlFromShell = process.env.DIRECT_URL;

if (databaseUrlFromShell !== undefined && databaseUrlFromShell !== "") {
  process.env.DATABASE_URL = databaseUrlFromShell;
}
if (directUrlFromShell !== undefined && directUrlFromShell !== "") {
  process.env.DIRECT_URL = directUrlFromShell;
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function numberArg(name: string, fallback: number): number {
  const raw = readArg(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} pozitif sayı olmalı.`);
  }
  return parsed;
}

function subtractDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() - days);
  return next;
}

async function resolveLatestSnapshotDate(fallbackDate: Date): Promise<Date> {
  const latestHistory = await prisma.fundPriceHistory.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return startOfUtcDay(latestHistory?.date ?? fallbackDate);
}

async function main() {
  const historyDays = numberArg("--history-days", 730);
  const historyChunkDays = numberArg("--history-chunk-days", 14);
  const macroDays = numberArg("--macro-days", 730);
  const staleMinutes = numberArg("--stale-minutes", 120);
  const skipWarm = process.argv.includes("--skip-warm");

  const tefasSync = await runFullTefasSync();
  if (!tefasSync.ok && !tefasSync.skipped) {
    throw new Error(tefasSync.message ?? "TEFAS tam sync başarısız.");
  }

  const historyRecovery = await recoverStaleHistorySyncState(staleMinutes);
  const history = await backfillFundHistoryDays(historyDays, undefined, historyChunkDays);

  const macroRecovery = await recoverStaleMacroSyncState(staleMinutes);
  const macroEndDate = startOfUtcDay(new Date());
  const macroStartDate = subtractDays(macroEndDate, macroDays);
  const macro = await syncMacroSeriesRange({
    startDate: macroStartDate,
    endDate: macroEndDate,
  });

  const snapshotDate = await resolveLatestSnapshotDate(startOfUtcDay(new Date(history.endDate)));
  const returns = await recomputeFundReturnsFromHistory({ targetSessionDate: snapshotDate });
  await rebuildMarketSnapshot(snapshotDate);
  const serving = await rebuildFundDailySnapshots(snapshotDate);
  const derived = await rebuildFundDerivedMetrics();
  const detailCore = await rebuildFundDetailCoreServingCache({ sourceDate: snapshotDate });
  const warm = skipWarm ? { written: 0, skipped: true } : await warmAllScoresApiCaches();

  await refreshFundHistorySyncState({
    phase: "bootstrap",
    source: "scripts/bootstrap-production.ts",
    bootstrap: {
      historyDays,
      historyChunkDays,
      snapshotDate: snapshotDate.toISOString(),
      returnsUpdatedFunds: returns.updatedFunds,
      servingWritten: serving.written,
      derivedWritten: derived.written,
      detailCoreWritten: detailCore.written,
      warmWritten: "written" in warm ? warm.written : 0,
      completedAt: new Date().toISOString(),
    },
    lastRecovery: historyRecovery,
  });

  await refreshMacroSyncState({
    phase: "bootstrap",
    bootstrap: {
      macroDays,
      startDate: macro.startDate,
      endDate: macro.endDate,
      seriesCount: macro.seriesCount,
      fetchedRows: macro.fetchedRows,
      writtenRows: macro.writtenRows,
      partial: macro.partial,
      completedAt: new Date().toISOString(),
    },
    lastRecovery: macroRecovery,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        tefasSync,
        historyRecovery,
        history,
        macroRecovery,
        macro,
        snapshotDate: snapshotDate.toISOString(),
        returns,
        serving,
        derived,
        detailCore,
        warm,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

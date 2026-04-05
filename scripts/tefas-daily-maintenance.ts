import { config } from "dotenv";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { rebuildFundDailySnapshots } from "../src/lib/services/fund-daily-snapshot.service";
import { warmAllScoresApiCaches } from "../src/lib/services/fund-scores-cache.service";
import {
  appendRecentFundHistory,
  refreshFundHistorySyncState,
  recoverStaleHistorySyncState,
} from "../src/lib/services/tefas-history.service";
import { rebuildMarketSnapshot, recomputeFundReturnsFromHistory, runFullTefasSync } from "../src/lib/services/tefas-sync.service";
import { startOfUtcDay } from "../src/lib/trading-calendar-tr";

config({ path: path.join(process.cwd(), ".env"), quiet: true });
config({ path: path.join(process.cwd(), ".env.local"), override: true, quiet: true });

async function resolveLatestSnapshotDate(): Promise<Date> {
  const latestHistory = await prisma.fundPriceHistory.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return startOfUtcDay(latestHistory?.date ?? new Date());
}

async function main() {
  const overlapDaysRaw = process.argv.includes("--overlap-days")
    ? process.argv[process.argv.indexOf("--overlap-days") + 1]
    : null;
  const staleMinutesRaw = process.argv.includes("--stale-minutes")
    ? process.argv[process.argv.indexOf("--stale-minutes") + 1]
    : null;

  const overlapDays = overlapDaysRaw ? Number(overlapDaysRaw) : 7;
  const staleMinutes = staleMinutesRaw ? Number(staleMinutesRaw) : 120;

  const sync = await runFullTefasSync().catch((error) => ({
    ok: false,
    skipped: false,
    updated: 0,
    message: error instanceof Error ? error.message : String(error),
  }));

  const recovery = await recoverStaleHistorySyncState(Number.isFinite(staleMinutes) ? staleMinutes : 120);
  const history = await appendRecentFundHistory(Number.isFinite(overlapDays) ? overlapDays : 7);

  const snapshotDate = await resolveLatestSnapshotDate();
  const returns = await recomputeFundReturnsFromHistory({ targetSessionDate: snapshotDate });
  await rebuildMarketSnapshot(snapshotDate);
  const serving = await rebuildFundDailySnapshots(snapshotDate);
  const warm = await warmAllScoresApiCaches();
  await refreshFundHistorySyncState({
    phase: "daily_maintenance",
    source: "scripts/tefas-daily-maintenance.ts",
    lastFundSync: {
      ok: "ok" in sync ? sync.ok : false,
      skipped: "skipped" in sync ? sync.skipped : false,
      updated: "updated" in sync ? sync.updated : 0,
      message: "message" in sync ? sync.message ?? null : null,
      completedAt: new Date().toISOString(),
    },
    lastHistoryRun: {
      mode: "append",
      startDate: history.startDate,
      endDate: history.endDate,
      chunkDays: history.chunkDays,
      chunks: history.chunks,
      fetchedRows: history.fetchedRows,
      writtenRows: history.writtenRows,
      touchedDates: history.touchedDates,
      completedAt: new Date().toISOString(),
    },
    lastAppendRange: {
      overlapDays: Number.isFinite(overlapDays) ? overlapDays : 7,
      startDate: history.startDate,
      endDate: history.endDate,
      completedAt: new Date().toISOString(),
    },
    lastDerivedRebuild: {
      snapshotDate: snapshotDate.toISOString(),
      updatedFunds: returns.updatedFunds,
      writtenSnapshots: serving.written,
      warmedCaches: warm.written,
      completedAt: new Date().toISOString(),
    },
    lastRecovery: recovery,
  });

  console.log(
    JSON.stringify(
      {
        sync,
        recovery,
        history,
        snapshotDate: snapshotDate.toISOString(),
        returns,
        serving,
        warm,
      },
      null,
      2
    )
  );

  const syncOk = "ok" in sync ? sync.ok || sync.skipped : false;
  process.exit(syncOk && history.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

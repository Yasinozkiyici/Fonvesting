import { config } from "dotenv";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import {
  appendRecentFundHistory,
  backfillFundHistoryDays,
  refreshFundHistorySyncState,
  recoverStaleHistorySyncState,
  syncFundHistoryRange,
} from "../src/lib/services/tefas-history.service";
import { rebuildFundDailySnapshots } from "../src/lib/services/fund-daily-snapshot.service";
import { warmAllScoresApiCaches } from "../src/lib/services/fund-scores-cache.service";
import { rebuildMarketSnapshot, recomputeFundReturnsFromHistory } from "../src/lib/services/tefas-sync.service";
import { startOfUtcDay } from "../src/lib/trading-calendar-tr";

config({ path: path.join(process.cwd(), ".env"), quiet: true });
config({ path: path.join(process.cwd(), ".env.local"), override: true, quiet: true });

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function parseDateArg(raw: string): Date {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    return new Date(Date.UTC(year as number, (month as number) - 1, day as number, 0, 0, 0, 0));
  }
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(trimmed)) {
    const [day, month, year] = trimmed.split(".").map(Number);
    return new Date(Date.UTC(year as number, (month as number) - 1, day as number, 0, 0, 0, 0));
  }
  throw new Error(`Geçersiz tarih argümanı: ${raw}`);
}

async function resolveLatestSnapshotDate(fallbackDate: Date): Promise<Date> {
  const latestHistory = await prisma.fundPriceHistory.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return startOfUtcDay(latestHistory?.date ?? fallbackDate);
}

async function main() {
  const daysRaw = readArg("--days");
  const fromRaw = readArg("--from");
  const toRaw = readArg("--to");
  const chunkDaysRaw = readArg("--chunk-days");
  const staleMinutesRaw = readArg("--stale-minutes");
  const append = process.argv.includes("--append");
  const chunkDays = chunkDaysRaw ? Number(chunkDaysRaw) : undefined;
  const staleMinutes = staleMinutesRaw ? Number(staleMinutesRaw) : 120;
  const appendOverlapDays = 7;

  const recovery = await recoverStaleHistorySyncState(Number.isFinite(staleMinutes) ? staleMinutes : 120);

  let result;
  if (append) {
    result = await appendRecentFundHistory(appendOverlapDays);
  } else if (fromRaw && toRaw) {
    result = await syncFundHistoryRange({
      startDate: parseDateArg(fromRaw),
      endDate: parseDateArg(toRaw),
      chunkDays,
    });
  } else {
    const days = daysRaw ? Number(daysRaw) : 730;
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error("--days pozitif sayı olmalı.");
    }
    result = await backfillFundHistoryDays(days, undefined, chunkDays);
  }

  const snapshotDate = await resolveLatestSnapshotDate(startOfUtcDay(new Date(result.endDate)));
  const returns = await recomputeFundReturnsFromHistory({ targetSessionDate: snapshotDate });
  await rebuildMarketSnapshot(snapshotDate);
  const serving = await rebuildFundDailySnapshots(snapshotDate);
  const warm = await warmAllScoresApiCaches();
  await refreshFundHistorySyncState({
    phase: append ? "history_append" : "history_backfill",
    source: "scripts/sync-tefas-history.ts",
    lastHistoryRun: {
      mode: append ? "append" : fromRaw && toRaw ? "range" : "backfill_days",
      startDate: result.startDate,
      endDate: result.endDate,
      chunkDays: result.chunkDays,
      chunks: result.chunks,
      fetchedRows: result.fetchedRows,
      writtenRows: result.writtenRows,
      touchedDates: result.touchedDates,
      completedAt: new Date().toISOString(),
    },
    lastAppendRange: append
      ? {
          overlapDays: appendOverlapDays,
          startDate: result.startDate,
          endDate: result.endDate,
          completedAt: new Date().toISOString(),
        }
      : undefined,
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
        history: result,
        recovery,
        returns,
        serving,
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

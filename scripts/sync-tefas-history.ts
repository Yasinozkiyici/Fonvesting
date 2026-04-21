import "./load-env";
import { prisma, resetPrismaEngine } from "../src/lib/prisma";
import { classifyDatabaseError } from "../src/lib/database-error-classifier";
import {
  appendRecentFundHistory,
  backfillFundHistoryDays,
  refreshFundHistorySyncState,
  recoverStaleHistorySyncState,
  syncFundHistoryRange,
} from "../src/lib/services/tefas-history.service";
import { rebuildFundDailySnapshots } from "../src/lib/services/fund-daily-snapshot.service";
import { rebuildFundDerivedMetrics } from "../src/lib/services/fund-derived-metrics.service";
import { rebuildFundDetailCoreServingCache } from "../src/lib/services/fund-detail-core-serving.service";
import { warmAllScoresApiCaches } from "../src/lib/services/fund-scores-cache.service";
import { rebuildMarketSnapshot, recomputeFundReturnsFromHistory } from "../src/lib/services/tefas-sync.service";
import { startOfUtcDay } from "../src/lib/trading-calendar-tr";

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

async function withDbRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const classified = classifyDatabaseError(error);
      if (!classified.retryable || attempt >= 3) throw error;
      console.warn(
        `[sync-tefas-history] transient_db_error label=${label} attempt=${attempt} class=${classified.category} ` +
          `prisma_code=${classified.prismaCode ?? "none"}`
      );
      await resetPrismaEngine();
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

async function resolveLatestSnapshotDate(fallbackDate: Date): Promise<Date> {
  const latestHistory = await withDbRetry("fundPriceHistory.findFirst", () =>
    prisma.fundPriceHistory.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    })
  );
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

  let recovery = { recovered: false, previousStatus: null as string | null };
  try {
    recovery = await withDbRetry("recoverStaleHistorySyncState", () =>
      recoverStaleHistorySyncState(Number.isFinite(staleMinutes) ? staleMinutes : 120)
    );
  } catch (error) {
    const classified = classifyDatabaseError(error);
    if (!classified.retryable) throw error;
    console.warn(
      `[sync-tefas-history] stale_recovery_skipped_due_db_fragility class=${classified.category} ` +
        `prisma_code=${classified.prismaCode ?? "none"}`
    );
  }

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
    const days = daysRaw ? Number(daysRaw) : 1095;
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error("--days pozitif sayı olmalı.");
    }
    result = await backfillFundHistoryDays(days, undefined, chunkDays);
  }

  const snapshotDate = await resolveLatestSnapshotDate(startOfUtcDay(new Date(result.endDate)));
  const returns = await recomputeFundReturnsFromHistory({ targetSessionDate: snapshotDate });
  await rebuildMarketSnapshot(snapshotDate);
  const serving = await rebuildFundDailySnapshots(snapshotDate);
  await rebuildFundDerivedMetrics();
  const detailCore = await rebuildFundDetailCoreServingCache({ sourceDate: snapshotDate });
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
      writtenDetailCore: detailCore.written,
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

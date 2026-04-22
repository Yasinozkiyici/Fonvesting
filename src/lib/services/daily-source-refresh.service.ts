import { setTimeout as sleep } from "node:timers/promises";
import { prisma } from "@/lib/prisma";
import { latestExpectedBusinessSessionDate } from "@/lib/daily-sync-policy";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import {
  appendRecentFundHistory,
  patchFundHistorySyncStateDetails,
  refreshFundHistorySyncState,
  recoverStaleHistorySyncState,
} from "@/lib/services/tefas-history.service";
import { appendRecentMacroSeries, recoverStaleMacroSyncState } from "@/lib/services/macro-series.service";

export type DailySourceRefreshResult = {
  attempts: {
    history: number;
    macro: number;
  };
  recovery: unknown;
  history: {
    ok: boolean;
    startDate: string;
    endDate: string;
    chunkDays: number;
    chunks: number;
    fetchedRows: number;
    writtenRows: number;
    touchedDates: number;
  };
  macroRecovery: unknown;
  macro: {
    ok: boolean;
    partial: boolean;
    startDate: string;
    endDate: string;
    seriesCount: number;
    fetchedRows: number;
    writtenRows: number;
    touchedDates: number;
    series: unknown[];
    message?: string;
  };
  timings: {
    totalMs: number;
    recoveryMs: number;
    historyMs: number;
    macroMs: number;
  };
};

const HISTORY_STEP_TIMEOUT_MS = 240_000;
const MACRO_STEP_TIMEOUT_MS = 120_000;
const IS_GITHUB_ACTIONS = String(process.env.GITHUB_ACTIONS ?? "").toLowerCase() === "true";
const SKIP_SOURCE_REFRESH_STATE_PATCH = IS_GITHUB_ACTIONS;
const SKIP_FRESHNESS_PROBE = IS_GITHUB_ACTIONS;

type SourceRefreshStage =
  | "start"
  | "recovery_done"
  | "history_start"
  | "history_done"
  | "macro_start"
  | "macro_done"
  | "completed"
  | "failed";

async function patchSourceRefreshStage(stage: SourceRefreshStage, details: Record<string, unknown>): Promise<void> {
  const payload = {
    phase: "source_refresh",
    stage,
    at: new Date().toISOString(),
    ...details,
  };
  console.info("[source-refresh] stage", payload);
  if (SKIP_SOURCE_REFRESH_STATE_PATCH) return;
  try {
    await patchFundHistorySyncStateDetails(payload);
  } catch (error) {
    console.warn("[source-refresh] stage_patch_failed", {
      stage,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function withStepTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout_${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readLatestHistoryDate(): Promise<Date | null> {
  const latest = await prisma.fundPriceHistory.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return latest?.date ?? null;
}

async function readLatestMacroObservationDate(): Promise<Date | null> {
  const latest = await prisma.macroObservation.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return latest?.date ?? null;
}

function isAtLeastExpectedSession(date: Date | null, expected: Date): boolean {
  return Boolean(date && startOfUtcDay(date).getTime() >= expected.getTime());
}

async function retryHistoryRefresh(overlapDays: number, attempts: number, baseDelayMs: number) {
  const expectedSessionDate = latestExpectedBusinessSessionDate();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await patchFundHistorySyncStateDetails({
      phase: "source_refresh",
      stage: "history_attempt",
      expectedSessionDate: expectedSessionDate.toISOString(),
      attempt,
      attempts,
      overlapDays,
    });
    try {
      const result = await withStepTimeout(
        appendRecentFundHistory(overlapDays + Math.max(0, attempt - 1) * 2),
        HISTORY_STEP_TIMEOUT_MS,
        "history_refresh"
      );
      if (!SKIP_FRESHNESS_PROBE) {
        const latestHistoryDate = await readLatestHistoryDate();
        if (!isAtLeastExpectedSession(latestHistoryDate, expectedSessionDate)) {
          throw new Error(
            `history_stale_after_refresh expected=${expectedSessionDate.toISOString()} latest=${latestHistoryDate?.toISOString() ?? "none"}`
          );
        }
      }
      return { result, attemptsUsed: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < attempts) {
        await sleep(baseDelayMs * attempt);
      }
    }
  }

  throw lastError ?? new Error("history_refresh_failed");
}

async function retryMacroRefresh(attempts: number, baseDelayMs: number) {
  const expectedSessionDate = latestExpectedBusinessSessionDate();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await patchFundHistorySyncStateDetails({
      phase: "source_refresh",
      stage: "macro_attempt",
      expectedSessionDate: expectedSessionDate.toISOString(),
      attempt,
      attempts,
    });
    try {
      const result = await withStepTimeout(
        appendRecentMacroSeries(),
        MACRO_STEP_TIMEOUT_MS,
        "macro_refresh"
      );
      if (!SKIP_FRESHNESS_PROBE) {
        const latestMacroDate = await readLatestMacroObservationDate();
        if (!isAtLeastExpectedSession(latestMacroDate, expectedSessionDate)) {
          throw new Error(
            `macro_stale_after_refresh expected=${expectedSessionDate.toISOString()} latest=${latestMacroDate?.toISOString() ?? "none"}`
          );
        }
      }
      return { result, attemptsUsed: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < attempts) {
        await sleep(baseDelayMs * attempt);
      }
    }
  }

  throw lastError ?? new Error("macro_refresh_failed");
}

export async function runDailySourceRefresh(options?: {
  overlapDays?: number;
  staleMinutes?: number;
  historyAttempts?: number;
  macroAttempts?: number;
  retryDelayMs?: number;
}): Promise<DailySourceRefreshResult> {
  const overlapDays = Number.isFinite(options?.overlapDays) ? Number(options?.overlapDays) : IS_GITHUB_ACTIONS ? 2 : 7;
  const staleMinutes = Number.isFinite(options?.staleMinutes) ? Number(options?.staleMinutes) : 120;
  const historyAttempts = Number.isFinite(options?.historyAttempts)
    ? Math.max(1, Number(options?.historyAttempts))
    : IS_GITHUB_ACTIONS
      ? 1
      : 3;
  const macroAttempts = Number.isFinite(options?.macroAttempts)
    ? Math.max(1, Number(options?.macroAttempts))
    : IS_GITHUB_ACTIONS
      ? 1
      : 3;
  const retryDelayMs = Number.isFinite(options?.retryDelayMs)
    ? Math.max(500, Number(options?.retryDelayMs))
    : IS_GITHUB_ACTIONS
      ? 2_000
      : 15_000;
  const runStartedAt = Date.now();

  await patchSourceRefreshStage("start", {
    overlapDays,
    staleMinutes,
    historyAttempts,
    macroAttempts,
    retryDelayMs,
  });

  try {
    const recoveryStartedAt = Date.now();
    const recovery = await recoverStaleHistorySyncState(staleMinutes);
    const macroRecovery = await recoverStaleMacroSyncState(staleMinutes);
    const recoveryDurationMs = Date.now() - recoveryStartedAt;
    await patchSourceRefreshStage("recovery_done", {
      durationMs: recoveryDurationMs,
      recovery,
      macroRecovery,
    });

    const historyStartedAt = Date.now();
    await patchSourceRefreshStage("history_start", {
      overlapDays,
      attempts: historyAttempts,
    });
    const { result: history, attemptsUsed: historyAttemptsUsed } = await retryHistoryRefresh(
      overlapDays,
      historyAttempts,
      retryDelayMs
    );
    const historyDurationMs = Date.now() - historyStartedAt;
    await patchSourceRefreshStage("history_done", {
      durationMs: historyDurationMs,
      attemptsUsed: historyAttemptsUsed,
      fetchedRows: history.fetchedRows,
      writtenRows: history.writtenRows,
      touchedDates: history.touchedDates,
      startDate: history.startDate,
      endDate: history.endDate,
    });

    const macroStartedAt = Date.now();
    await patchSourceRefreshStage("macro_start", {
      attempts: macroAttempts,
    });
    const macroAttemptResult = await retryMacroRefresh(macroAttempts, retryDelayMs).catch((error) => ({
      attemptsUsed: macroAttempts,
      result: {
        ok: false,
        partial: false,
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
        seriesCount: 0,
        fetchedRows: 0,
        writtenRows: 0,
        touchedDates: 0,
        series: [] as unknown[],
        message: error instanceof Error ? error.message : String(error),
      },
    }));
    const macroDurationMs = Date.now() - macroStartedAt;
    const macro = macroAttemptResult.result;
    await patchSourceRefreshStage("macro_done", {
      durationMs: macroDurationMs,
      attemptsUsed: macroAttemptResult.attemptsUsed,
      ok: macro.ok,
      partial: macro.partial,
      fetchedRows: macro.fetchedRows,
      writtenRows: macro.writtenRows,
      touchedDates: macro.touchedDates,
      startDate: macro.startDate,
      endDate: macro.endDate,
      message: "message" in macro ? macro.message ?? null : null,
    });

    if (!SKIP_SOURCE_REFRESH_STATE_PATCH) {
      await refreshFundHistorySyncState({
        phase: "source_refresh",
        source: "src/lib/services/daily-source-refresh.service.ts",
        attempts: {
          history: historyAttemptsUsed,
          macro: macroAttemptResult.attemptsUsed,
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
          overlapDays,
          startDate: history.startDate,
          endDate: history.endDate,
          completedAt: new Date().toISOString(),
        },
        lastMacroSync: {
          ok: "ok" in macro ? macro.ok : false,
          partial: "partial" in macro ? macro.partial : false,
          fetchedRows: "fetchedRows" in macro ? macro.fetchedRows : 0,
          writtenRows: "writtenRows" in macro ? macro.writtenRows : 0,
          seriesCount: "seriesCount" in macro ? macro.seriesCount : 0,
          message: "message" in macro ? macro.message ?? null : null,
          completedAt: new Date().toISOString(),
        },
        lastMacroRecovery: macroRecovery,
        lastRecovery: recovery,
        sourceRefreshTimingMs: {
          total: Date.now() - runStartedAt,
          recovery: recoveryDurationMs,
          history: historyDurationMs,
          macro: macroDurationMs,
        },
      });
    }

    await patchSourceRefreshStage("completed", {
      durationMs: Date.now() - runStartedAt,
      historyAttemptsUsed,
      macroAttemptsUsed: macroAttemptResult.attemptsUsed,
      historyEndDate: history.endDate,
      macroEndDate: macro.endDate,
      macroOk: macro.ok,
      macroPartial: macro.partial,
    });

    return {
      attempts: {
        history: historyAttemptsUsed,
        macro: macroAttemptResult.attemptsUsed,
      },
      recovery,
      history,
      macroRecovery,
      macro,
      timings: {
        totalMs: Date.now() - runStartedAt,
        recoveryMs: recoveryDurationMs,
        historyMs: historyDurationMs,
        macroMs: macroDurationMs,
      },
    };
  } catch (error) {
    await patchSourceRefreshStage("failed", {
      durationMs: Date.now() - runStartedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

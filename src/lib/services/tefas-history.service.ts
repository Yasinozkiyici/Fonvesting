import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TefasBrowserClient, withTefasBrowserClient, type TefasExportPayload } from "@/lib/services/tefas-browser.service";
import { parseTefasSessionDate, startOfUtcDay } from "@/lib/trading-calendar-tr";

const HISTORY_SYNC_KEY = "tefas_fund_history";
const DEFAULT_CHUNK_DAYS = 14;
const UPSERT_CHUNK = 500;
const DEFAULT_STALE_RUN_MINUTES = 120;

export type FundHistorySyncResult = {
  ok: boolean;
  startDate: string;
  endDate: string;
  chunkDays: number;
  chunks: number;
  fetchedRows: number;
  writtenRows: number;
  touchedDates: number;
};

export type HistorySyncRecoveryResult = {
  recovered: boolean;
  previousStatus: string | null;
  reason?: string;
};

function formatDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}

function parseInputDate(input: string): Date {
  const trimmed = input.trim();
  const ddmmyyyy = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/;
  let date: Date | null = null;
  const ddmmyyyyMatch = ddmmyyyy.exec(trimmed);
  if (ddmmyyyyMatch) {
    date = parseTefasSessionDate(trimmed);
  } else {
    const isoMatch = iso.exec(trimmed);
    if (isoMatch) {
      date = new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), 0, 0, 0, 0));
    }
  }
  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`Geçersiz tarih: ${input}`);
  }
  return startOfUtcDay(date);
}

function businessDaysBetween(startDate: Date, endDate: Date): Date[] {
  const out: Date[] = [];
  const cursor = new Date(startDate);
  while (cursor.getTime() <= endDate.getTime()) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      out.push(new Date(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function chunkDates(dates: Date[], chunkDays: number): Array<{ start: Date; end: Date }> {
  const chunks: Array<{ start: Date; end: Date }> = [];
  for (let i = 0; i < dates.length; i += chunkDays) {
    const slice = dates.slice(i, i + chunkDays);
    if (slice.length === 0) continue;
    chunks.push({
      start: slice[0] as Date,
      end: slice[slice.length - 1] as Date,
    });
  }
  return chunks;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizeSessionDate(raw: string | null | undefined, fallbackDate: Date): Date {
  if (!raw?.trim()) return fallbackDate;
  const parsed = parseTefasSessionDate(raw.trim());
  return parsed ? startOfUtcDay(parsed) : fallbackDate;
}

function buildChunkCacheKey(chunk: { start: Date; end: Date }, fundTypeCode: number): string {
  return `${formatDate(chunk.start)}:${formatDate(chunk.end)}:${fundTypeCode}`;
}

async function fetchHistoryChunk(
  client: TefasBrowserClient,
  chunk: { start: Date; end: Date },
  fundTypeCode: 0 | 1
): Promise<TefasExportPayload> {
  return client.fetchPayload({
    fundTypeCode,
    fromDate: chunk.start,
    toDate: chunk.end,
  });
}

function splitChunk(chunk: { start: Date; end: Date }): Array<{ start: Date; end: Date }> {
  const dates = businessDaysBetween(chunk.start, chunk.end);
  if (dates.length <= 1) return [chunk];
  const mid = Math.floor(dates.length / 2);
  return [
    { start: dates[0] as Date, end: dates[Math.max(0, mid - 1)] as Date },
    { start: dates[mid] as Date, end: dates[dates.length - 1] as Date },
  ];
}

async function fetchHistoryChunkWithFallback(
  client: TefasBrowserClient,
  chunk: { start: Date; end: Date },
  fundTypeCode: 0 | 1
): Promise<TefasExportPayload[]> {
  try {
    return [await fetchHistoryChunk(client, chunk, fundTypeCode)];
  } catch (error) {
    const parts = splitChunk(chunk);
    if (parts.length <= 1) throw error;
    const out: TefasExportPayload[] = [];
    for (const part of parts) {
      out.push(...(await fetchHistoryChunkWithFallback(client, part, fundTypeCode)));
    }
    return out;
  }
}

type NormalizedHistoryRow = {
  fundId: string;
  date: Date;
  price: number;
  portfolioSize: number;
  investorCount: number;
};

async function loadActiveFundMap(): Promise<Map<string, string>> {
  const funds = await prisma.fund.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
  });
  return new Map(funds.map((fund) => [fund.code, fund.id]));
}

function mergePayloadRows(
  payloads: TefasExportPayload[],
  fundIdByCode: Map<string, string>,
  fallbackDate: Date
): NormalizedHistoryRow[] {
  const merged = new Map<string, NormalizedHistoryRow>();

  for (const payload of payloads) {
    if (!payload.ok || ("empty" in payload && payload.empty) || !("rows" in payload)) continue;

    for (const row of payload.rows) {
      const fundId = fundIdByCode.get(row.code);
      if (!fundId || !Number.isFinite(row.lastPrice) || row.lastPrice <= 0) continue;

      const sessionDate = normalizeSessionDate(row.date ?? payload.date, fallbackDate);
      const key = `${fundId}:${sessionDate.toISOString()}`;
      merged.set(key, {
        fundId,
        date: sessionDate,
        price: row.lastPrice,
        portfolioSize: row.portfolioSize || 0,
        investorCount: row.investorCount || 0,
      });
    }
  }

  return [...merged.values()];
}

async function upsertHistoryRows(rows: NormalizedHistoryRow[]): Promise<number> {
  let written = 0;

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const slice = rows.slice(i, i + UPSERT_CHUNK);
    const values = Prisma.join(
      slice.map(
        (row) =>
          Prisma.sql`(${randomUUID()}, ${row.fundId}, ${row.date}, ${row.price}, ${row.portfolioSize}, ${row.investorCount})`
      )
    );

    await prisma.$executeRaw`
      INSERT INTO "FundPriceHistory" ("id", "fundId", "date", "price", "portfolioSize", "investorCount")
      VALUES ${values}
      ON CONFLICT ("fundId", "date") DO UPDATE
      SET
        "price" = EXCLUDED."price",
        "portfolioSize" = EXCLUDED."portfolioSize",
        "investorCount" = EXCLUDED."investorCount"
    `;
    written += slice.length;
  }

  return written;
}

export async function refreshFundHistorySyncState(details?: Record<string, unknown>): Promise<void> {
  const [minDate, maxDate] = await Promise.all([
    prisma.fundPriceHistory.findFirst({
      orderBy: { date: "asc" },
      select: { date: true },
    }),
    prisma.fundPriceHistory.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    }),
  ]);

  await prisma.historySyncState.upsert({
    where: { key: HISTORY_SYNC_KEY },
    create: {
      key: HISTORY_SYNC_KEY,
      status: "READY",
      earliestHistoryDate: minDate?.date ?? null,
      latestHistoryDate: maxDate?.date ?? null,
      lastCompletedAt: new Date(),
      details: toJson(details ?? {}),
    },
    update: {
      status: "READY",
      earliestHistoryDate: minDate?.date ?? null,
      latestHistoryDate: maxDate?.date ?? null,
      lastCompletedAt: new Date(),
      details: toJson(details ?? {}),
    },
  });
}

export async function recoverStaleHistorySyncState(staleAfterMinutes: number = DEFAULT_STALE_RUN_MINUTES): Promise<HistorySyncRecoveryResult> {
  const state = await prisma.historySyncState.findUnique({
    where: { key: HISTORY_SYNC_KEY },
    select: {
      status: true,
      lastStartedAt: true,
      details: true,
    },
  });

  if (!state || state.status !== "RUNNING" || !state.lastStartedAt) {
    return { recovered: false, previousStatus: state?.status ?? null };
  }

  const staleAfterMs = Math.max(1, staleAfterMinutes) * 60 * 1000;
  const ageMs = Date.now() - state.lastStartedAt.getTime();
  if (ageMs < staleAfterMs) {
    return { recovered: false, previousStatus: state.status };
  }

  const previousDetails =
    state.details && typeof state.details === "object" && !Array.isArray(state.details)
      ? (state.details as Record<string, unknown>)
      : {};

  await prisma.historySyncState.update({
    where: { key: HISTORY_SYNC_KEY },
    data: {
      status: "FAILED",
      lastCompletedAt: new Date(),
      details: toJson({
        ...previousDetails,
        phase: "stale_run_recovered",
        recoveredAt: new Date().toISOString(),
        staleAfterMinutes,
        previousStatus: state.status,
        previousLastStartedAt: state.lastStartedAt.toISOString(),
      }),
    },
  });

  await prisma.syncLog.create({
    data: {
      syncType: "TEFAS_HISTORY",
      status: "FAILED",
      fundsUpdated: 0,
      fundsCreated: 0,
      errorMessage: `stale_run_recovered_after_${staleAfterMinutes}m`,
      startedAt: state.lastStartedAt,
      completedAt: new Date(),
      durationMs: ageMs,
    },
  });

  return {
    recovered: true,
    previousStatus: state.status,
    reason: `stale_run_recovered_after_${staleAfterMinutes}m`,
  };
}

export async function syncFundHistoryRange(options: {
  startDate: Date;
  endDate: Date;
  chunkDays?: number;
}): Promise<FundHistorySyncResult> {
  const startDate = startOfUtcDay(options.startDate);
  const endDate = startOfUtcDay(options.endDate);
  if (endDate.getTime() < startDate.getTime()) {
    throw new Error("Bitiş tarihi başlangıçtan önce olamaz.");
  }

  const chunkDays = Math.max(1, options.chunkDays ?? DEFAULT_CHUNK_DAYS);
  const dates = businessDaysBetween(startDate, endDate);
  const chunks = chunkDates(dates, chunkDays);
  const fundIdByCode = await loadActiveFundMap();

  await prisma.historySyncState.upsert({
    where: { key: HISTORY_SYNC_KEY },
    create: {
      key: HISTORY_SYNC_KEY,
      status: "RUNNING",
      lastStartedAt: new Date(),
      details: toJson({
        phase: "history_backfill",
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        chunkDays,
      }),
    },
    update: {
      status: "RUNNING",
      lastStartedAt: new Date(),
      details: toJson({
        phase: "history_backfill",
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        chunkDays,
      }),
    },
  });

  try {
    let fetchedRows = 0;
    let writtenRows = 0;
    const touchedDates = new Set<number>();
    await withTefasBrowserClient(async (client) => {
      for (const chunk of chunks) {
        const payloads: TefasExportPayload[] = [];

        for (const fundTypeCode of [0, 1] as const) {
          const parts = await fetchHistoryChunkWithFallback(client, chunk, fundTypeCode);
          for (const payload of parts) {
            if (!payload.ok) {
              throw new Error(`[history-sync] ${buildChunkCacheKey(chunk, fundTypeCode)} -> ${payload.error}`);
            }
            payloads.push(payload);
          }
        }

        for (const payload of payloads) {
          if (payload.ok && !("empty" in payload && payload.empty) && "rows" in payload) {
            fetchedRows += payload.rows.length;
          }
        }

        const rows = mergePayloadRows(payloads, fundIdByCode, chunk.end);
        for (const row of rows) touchedDates.add(row.date.getTime());
        writtenRows += await upsertHistoryRows(rows);
      }
    });

    const details = {
      phase: "history_backfill",
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      chunkDays,
      chunks: chunks.length,
      fetchedRows,
      writtenRows,
      touchedDates: touchedDates.size,
    };

    await refreshFundHistorySyncState(details);
    await prisma.syncLog.create({
      data: {
        syncType: "TEFAS_HISTORY",
        status: "SUCCESS",
        fundsUpdated: writtenRows,
        fundsCreated: 0,
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 0,
      },
    });

    return {
      ok: true,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      chunkDays,
      chunks: chunks.length,
      fetchedRows,
      writtenRows,
      touchedDates: touchedDates.size,
    };
  } catch (error) {
    await prisma.historySyncState.upsert({
      where: { key: HISTORY_SYNC_KEY },
      create: {
        key: HISTORY_SYNC_KEY,
        status: "FAILED",
        lastStartedAt: new Date(),
        details: toJson({
          phase: "history_backfill",
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          chunkDays,
          error: error instanceof Error ? error.message : String(error),
        }),
      },
      update: {
        status: "FAILED",
        details: toJson({
          phase: "history_backfill",
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          chunkDays,
          error: error instanceof Error ? error.message : String(error),
        }),
      },
    });
    throw error;
  }
}

export async function backfillFundHistoryDays(days: number, anchorDate?: Date, chunkDays?: number): Promise<FundHistorySyncResult> {
  const endDate = startOfUtcDay(anchorDate ?? new Date());
  const startDate = new Date(endDate.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000);
  return syncFundHistoryRange({ startDate, endDate, chunkDays: chunkDays ?? DEFAULT_CHUNK_DAYS });
}

export async function appendRecentFundHistory(overlapDays: number = 7): Promise<FundHistorySyncResult> {
  const latest = await prisma.fundPriceHistory.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });

  const endDate = startOfUtcDay(new Date());
  const startDate = latest?.date
    ? new Date(startOfUtcDay(latest.date).getTime() - Math.max(1, overlapDays) * 24 * 60 * 60 * 1000)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  return syncFundHistoryRange({ startDate, endDate, chunkDays: DEFAULT_CHUNK_DAYS });
}

import { prisma, resetPrismaEngine } from "@/lib/prisma";
import { classifyDatabaseError } from "@/lib/database-error-classifier";
import {
  deriveFundPerformanceFromHistory,
  FUND_PRICE_HISTORY_LOOKBACK_DAYS,
} from "@/lib/services/fund-daily-snapshot.service";
import { TefasBrowserClient, withTefasBrowserClient, type TefasExportPayload } from "@/lib/services/tefas-browser.service";
import { refreshFundHistorySyncState } from "@/lib/services/tefas-history.service";
import { runTefasMetadataPass } from "@/lib/services/tefas-metadata.service";
import { rebuildFundDailySnapshots } from "@/lib/services/fund-daily-snapshot.service";
import { rebuildFundDerivedMetrics } from "@/lib/services/fund-derived-metrics.service";
import { rebuildFundDetailCoreServingCache } from "@/lib/services/fund-detail-core-serving.service";
import { warmAllScoresApiCaches } from "@/lib/services/fund-scores-cache.service";
import { parseTefasSessionDate, startOfUtcDay } from "@/lib/trading-calendar-tr";
import { fetchUsdTryEurTryLive } from "@/lib/services/exchange-rates.service";
import { classifyDailyReturnPctPoints2dp, countDailyReturnDirections } from "@/lib/daily-return-ui";

const DAY_MS = 24 * 60 * 60 * 1000;
const TURKEY_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

export type TefasSyncResult = {
  ok: boolean;
  skipped: boolean;
  updated: number;
  message?: string;
};

type SyncLogWriteInput = {
  syncType: string;
  status: string;
  fundsUpdated: number;
  fundsCreated: number;
  errorMessage?: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
};

async function writeSyncLogSafe(data: SyncLogWriteInput, context: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await prisma.syncLog.create({ data });
      return;
    } catch (error) {
      const classified = classifyDatabaseError(error);
      if (!classified.retryable || attempt >= 3) {
        console.error(
          `[tefas-sync] sync_log_write_failed context=${context} class=${classified.category} ` +
            `prisma_code=${classified.prismaCode ?? "none"}`
        );
        return;
      }
      await resetPrismaEngine();
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

function clampReturn(x: number): number {
  if (!Number.isFinite(x) || Math.abs(x) > 100) return 0;
  return x;
}

function computePct(prev: number, curr: number): number {
  return ((curr - prev) / prev) * 100;
}

function isUsablePrice(x: number): boolean {
  return Number.isFinite(x) && x > 0;
}

function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

function normalizeHistorySessionDate(date: Date): Date {
  return startOfUtcDay(new Date(date.getTime() + TURKEY_UTC_OFFSET_MS));
}

function sameUtcDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

function getDistinctHistorySessions(
  bars: Array<{ id: string; date: Date; price: number }>
): Array<{ sessionDate: Date; price: number; historyIds: string[] }> {
  const sessions = new Map<number, { sessionDate: Date; price: number; historyIds: string[] }>();

  for (const bar of bars) {
    if (!isUsablePrice(bar.price)) continue;
    const sessionDate = normalizeHistorySessionDate(bar.date);
    const key = sessionDate.getTime();
    const existing = sessions.get(key);
    if (existing) {
      existing.historyIds.push(bar.id);
      continue;
    }
    sessions.set(key, { sessionDate, price: bar.price, historyIds: [bar.id] });
  }

  return [...sessions.values()].sort((a, b) => b.sessionDate.getTime() - a.sessionDate.getTime());
}

type ExistingSyncFundRow = {
  id: string;
  code: string;
  lastPrice: number;
  previousPrice: number;
  dailyReturn: number;
};

type RecentSyncHistoryRow = {
  id: string;
  fundId: string;
  date: Date;
  price: number;
};

async function loadExistingFundsForSync(codes: string[]): Promise<Map<string, ExistingSyncFundRow>> {
  if (codes.length === 0) return new Map();

  const rows = await prisma.fund.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, lastPrice: true, previousPrice: true, dailyReturn: true },
  });

  return new Map(rows.map((row) => [row.code, row]));
}

async function loadRecentHistoryForSync(
  fundIds: string[],
  sessionDayStart: Date
): Promise<Map<string, RecentSyncHistoryRow[]>> {
  if (fundIds.length === 0) return new Map();

  const rows = await prisma.fundPriceHistory.findMany({
    where: {
      fundId: { in: fundIds },
      date: { gte: new Date(sessionDayStart.getTime() - 7 * DAY_MS) },
    },
    orderBy: [{ fundId: "asc" }, { date: "desc" }],
    select: { id: true, fundId: true, date: true, price: true },
  });

  const map = new Map<string, RecentSyncHistoryRow[]>();
  for (const row of rows) {
    const bucket = map.get(row.fundId) ?? [];
    bucket.push(row);
    map.set(row.fundId, bucket);
  }
  return map;
}

/**
 * Günlük %: TEFAS sütunu → satır (önceki/son fiyat) → history’de önceki gün → DB’deki son kapanış.
 * UI ile uyum için |%| > 100 sapmaları 0 sayılır (badge ile aynı eşik).
 */
function computeFundDailyMetrics(input: {
  apiDailyReturn: number;
  lastPrice: number;
  rowPreviousPrice: number;
  dbPreviousClose: number;
  historyPreviousPrice: number;
  existingPreviousPrice: number;
  existingDailyReturn: number;
  sameSessionPrice: number;
}): { dailyReturn: number; previousPrice: number } {
  const apiDailyReturn = Number(input.apiDailyReturn);
  const lastPrice = Number(input.lastPrice);
  const rowPreviousPrice = Number(input.rowPreviousPrice);
  const dbPreviousClose = Number(input.dbPreviousClose);
  const historyPreviousPrice = Number(input.historyPreviousPrice);
  const existingPreviousPrice = Number(input.existingPreviousPrice);
  const existingDailyReturn = Number(input.existingDailyReturn);
  const sameSessionPrice = Number(input.sameSessionPrice);

  const isSameSessionResync = isUsablePrice(sameSessionPrice);

  let previousPrice = 0;
  if (isSameSessionResync && isUsablePrice(existingPreviousPrice)) {
    previousPrice = existingPreviousPrice;
  } else if (isUsablePrice(rowPreviousPrice) && !almostEqual(rowPreviousPrice, lastPrice)) {
    previousPrice = rowPreviousPrice;
  } else if (isUsablePrice(dbPreviousClose) && (!isSameSessionResync || !almostEqual(dbPreviousClose, lastPrice))) {
    previousPrice = dbPreviousClose;
  } else if (isUsablePrice(historyPreviousPrice)) {
    previousPrice = historyPreviousPrice;
  } else if (isUsablePrice(existingPreviousPrice)) {
    previousPrice = existingPreviousPrice;
  } else if (isUsablePrice(rowPreviousPrice)) {
    previousPrice = rowPreviousPrice;
  }

  let dailyReturn = 0;
  if (apiDailyReturn !== 0 && Number.isFinite(apiDailyReturn)) {
    dailyReturn = clampReturn(apiDailyReturn);
  } else if (previousPrice > 0 && lastPrice > 0) {
    dailyReturn = clampReturn(computePct(previousPrice, lastPrice));
  } else if (isSameSessionResync && Number.isFinite(existingDailyReturn)) {
    dailyReturn = clampReturn(existingDailyReturn);
  }

  return { dailyReturn, previousPrice };
}

export async function recomputeDailyReturnsFromHistory(options?: {
  targetSessionDate?: Date;
}): Promise<{ updatedFunds: number; updatedHistoryRows: number }> {
  const targetSessionDate = options?.targetSessionDate ?? null;
  const horizon = new Date((targetSessionDate ?? new Date()).getTime() - 14 * DAY_MS);

  const funds = await prisma.fund.findMany({
    where: { isActive: true },
    select: { id: true, lastPrice: true, previousPrice: true, dailyReturn: true },
  });
  const historyRows = await prisma.fundPriceHistory.findMany({
    where: { date: { gte: horizon } },
    select: { id: true, fundId: true, date: true, price: true },
    orderBy: [{ fundId: "asc" }, { date: "desc" }],
  });

  const historyByFund = new Map<string, Array<{ id: string; date: Date; price: number }>>();
  for (const row of historyRows) {
    const arr = historyByFund.get(row.fundId) ?? [];
    arr.push(row);
    historyByFund.set(row.fundId, arr);
  }

  const fundUpdates: Array<{ id: string; lastPrice: number; previousPrice: number; dailyReturn: number }> = [];
  const historyUpdates: Array<{ id: string; dailyReturn: number }> = [];

  for (const fund of funds) {
    const sessions = getDistinctHistorySessions(historyByFund.get(fund.id) ?? []);
    if (!sessions.length) continue;

    const current =
      targetSessionDate != null
        ? sessions.find((session) => sameUtcDay(session.sessionDate, targetSessionDate))
        : sessions[0];
    if (!current) continue;

    const previous = sessions.find((session) => session.sessionDate.getTime() < current.sessionDate.getTime());
    if (!previous || !isUsablePrice(current.price) || !isUsablePrice(previous.price)) continue;

    const dailyReturn = clampReturn(computePct(previous.price, current.price));
    if (
      almostEqual(fund.lastPrice, current.price) &&
      almostEqual(fund.previousPrice, previous.price) &&
      almostEqual(fund.dailyReturn, dailyReturn)
    ) {
      continue;
    }

    fundUpdates.push({
      id: fund.id,
      lastPrice: current.price,
      previousPrice: previous.price,
      dailyReturn,
    });

    for (const historyId of current.historyIds) {
      historyUpdates.push({ id: historyId, dailyReturn });
    }
  }

  const CHUNK = 200;
  for (let i = 0; i < fundUpdates.length; i += CHUNK) {
    const slice = fundUpdates.slice(i, i + CHUNK);
    await prisma.$transaction(
      slice.map((item) =>
        prisma.fund.update({
          where: { id: item.id },
          data: {
            lastPrice: item.lastPrice,
            previousPrice: item.previousPrice,
            dailyReturn: item.dailyReturn,
          },
        })
      )
    );
  }

  for (let i = 0; i < historyUpdates.length; i += CHUNK) {
    const slice = historyUpdates.slice(i, i + CHUNK);
    await prisma.$transaction(
      slice.map((item) =>
        prisma.fundPriceHistory.update({
          where: { id: item.id },
          data: { dailyReturn: item.dailyReturn },
        })
      )
    );
  }

  return { updatedFunds: fundUpdates.length, updatedHistoryRows: historyUpdates.length };
}

export async function recomputeFundReturnsFromHistory(options?: {
  targetSessionDate?: Date;
}): Promise<{ updatedFunds: number }> {
  const targetSessionDate = options?.targetSessionDate ?? null;
  const horizon = new Date(
    (targetSessionDate ?? new Date()).getTime() - FUND_PRICE_HISTORY_LOOKBACK_DAYS * DAY_MS
  );

  const funds = await prisma.fund.findMany({
    where: { isActive: true },
    select: {
      id: true,
      lastPrice: true,
      previousPrice: true,
      dailyReturn: true,
      weeklyReturn: true,
      monthlyReturn: true,
      yearlyReturn: true,
    },
  });
  const historyRows = await prisma.fundPriceHistory.findMany({
    where: { date: { gte: horizon } },
    select: { fundId: true, date: true, price: true },
    orderBy: [{ fundId: "asc" }, { date: "asc" }],
  });

  const historyByFund = new Map<string, Array<{ date: Date; price: number }>>();
  for (const row of historyRows) {
    const arr = historyByFund.get(row.fundId) ?? [];
    arr.push({ date: row.date, price: row.price });
    historyByFund.set(row.fundId, arr);
  }

  const updates = funds
    .map((fund) => {
      const performance = deriveFundPerformanceFromHistory(historyByFund.get(fund.id) ?? []);
      if (!performance.lastPrice) return null;
      const unchanged =
        almostEqual(fund.lastPrice, performance.lastPrice) &&
        almostEqual(fund.previousPrice, performance.previousPrice) &&
        almostEqual(fund.dailyReturn, performance.dailyReturn) &&
        almostEqual(fund.weeklyReturn, performance.weeklyReturn) &&
        almostEqual(fund.monthlyReturn, performance.monthlyReturn) &&
        almostEqual(fund.yearlyReturn, performance.yearlyReturn);
      if (unchanged) return null;
      return {
        id: fund.id,
        lastPrice: performance.lastPrice,
        previousPrice: performance.previousPrice,
        dailyReturn: performance.dailyReturn,
        weeklyReturn: performance.weeklyReturn,
        monthlyReturn: performance.monthlyReturn,
        yearlyReturn: performance.yearlyReturn,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item != null);

  const CHUNK = 200;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK);
    await prisma.$transaction(
      slice.map((item) =>
        prisma.fund.update({
          where: { id: item.id },
          data: {
            lastPrice: item.lastPrice,
            previousPrice: item.previousPrice,
            dailyReturn: item.dailyReturn,
            weeklyReturn: item.weeklyReturn,
            monthlyReturn: item.monthlyReturn,
            yearlyReturn: item.yearlyReturn,
          },
        })
      )
    );
  }

  return { updatedFunds: updates.length };
}

export async function rebuildMarketSnapshot(snapshotDate: Date): Promise<void> {
  const sessionDayStart = startOfUtcDay(snapshotDate);
  await prisma.$transaction(async (tx) => {
    const all = await tx.fund.findMany({
      where: { isActive: true },
      select: { dailyReturn: true, portfolioSize: true, investorCount: true },
    });
    const dir = countDailyReturnDirections(all.map((f) => f.dailyReturn));
    const adv = dir.advancers;
    const dec = dir.decliners;
    const unch = dir.unchanged;
    const rets = all.map((f) => f.dailyReturn).filter((x) => classifyDailyReturnPctPoints2dp(x) !== "neutral");
    const avg = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;

    await tx.marketSnapshot.upsert({
      where: { date: sessionDayStart },
      create: {
        date: sessionDayStart,
        totalFundCount: all.length,
        totalPortfolioSize: all.reduce((s, f) => s + f.portfolioSize, 0),
        totalInvestorCount: all.reduce((s, f) => s + f.investorCount, 0),
        avgDailyReturn: avg,
        advancers: adv,
        decliners: dec,
        unchanged: unch,
      },
      update: {
        totalFundCount: all.length,
        totalPortfolioSize: all.reduce((s, f) => s + f.portfolioSize, 0),
        totalInvestorCount: all.reduce((s, f) => s + f.investorCount, 0),
        avgDailyReturn: avg,
        advancers: adv,
        decliners: dec,
        unchanged: unch,
      },
    });
  });

  const rates = await fetchUsdTryEurTryLive();
  if (rates) {
    await prisma.marketSnapshot.updateMany({
      where: { date: sessionDayStart },
      data: { usdTry: rates.usdTry, eurTry: rates.eurTry },
    });
  }
}

async function ensureFundTypes(fundTypeCode: number): Promise<string> {
  const names: Record<number, string> = {
    0: "Yatırım Fonları",
    1: "Emeklilik Fonları",
  };
  const row = await prisma.fundType.upsert({
    where: { code: fundTypeCode },
    create: {
      code: fundTypeCode,
      name: names[fundTypeCode] ?? `Tür ${fundTypeCode}`,
    },
    update: { name: names[fundTypeCode] ?? `Tür ${fundTypeCode}` },
  });
  return row.id;
}

async function fetchLatestAvailablePayload(input: {
  fundTypeCode: 0 | 1;
  client?: TefasBrowserClient | null;
}): Promise<TefasExportPayload> {
  const fetchWithClient = input.client
    ? input.client.fetchPayload.bind(input.client)
    : (request: Parameters<TefasBrowserClient["fetchPayload"]>[0]) =>
        withTefasBrowserClient((browserClient) => browserClient.fetchPayload(request));

  const today = new Date();
  for (let back = 0; back < 7; back += 1) {
    const candidate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back));
    const day = candidate.getUTCDay();
    if (day === 0 || day === 6) continue;
    const payload = await fetchWithClient({
      fundTypeCode: input.fundTypeCode,
      date: candidate,
    });
    if (payload.ok && !("empty" in payload && payload.empty) && "rows" in payload && payload.rows.length > 0) {
      return payload;
    }
  }

  return {
    ok: true,
    empty: true,
    date: "",
    fundTypeCode: input.fundTypeCode,
  };
}

export async function runTefasSync(options?: {
  fundTypeCode?: number;
  /** true: kategori/logo pass atlanır (runFullTefasSync son turda bir kez çalıştırır). */
  skipMetadata?: boolean;
  /** true: market/snapshot/cache rebuild atlanır (full sync sonunda bir kez çalıştırılır). */
  skipDerivedRebuilds?: boolean;
  client?: TefasBrowserClient;
}): Promise<TefasSyncResult> {
  const fundTypeCode = options?.fundTypeCode ?? 0;
  const skipMetadata = options?.skipMetadata ?? false;
  const skipDerivedRebuilds = options?.skipDerivedRebuilds ?? false;
  const started = Date.now();
  const client = options?.client ?? null;

  let payload: TefasExportPayload;
  try {
    payload = await fetchLatestAvailablePayload({
      fundTypeCode: fundTypeCode as 0 | 1,
      client,
    });
  } catch (e: unknown) {
    const msg = (e instanceof Error ? e.message : String(e)) || "TEFAS browser fetch çalıştırılamadı";
    console.error("[tefas-sync] TEFAS çekilemedi, mevcut veri korunuyor:", msg);
    await writeSyncLogSafe(
      {
        syncType: "TEFAS",
        status: "FAILED",
        fundsUpdated: 0,
        fundsCreated: 0,
        errorMessage: msg.slice(0, 2000),
        startedAt: new Date(started),
        completedAt: new Date(),
        durationMs: Date.now() - started,
      },
      "fetch_latest_payload_exception"
    );
    return { ok: false, skipped: true, updated: 0, message: msg };
  }

  if (!payload.ok) {
    const msg = "error" in payload ? payload.error : "bilinmeyen";
    console.error("[tefas-sync] Payload hata:", msg);
    await writeSyncLogSafe(
      {
        syncType: "TEFAS",
        status: "FAILED",
        fundsUpdated: 0,
        fundsCreated: 0,
        errorMessage: msg,
        startedAt: new Date(started),
        completedAt: new Date(),
        durationMs: Date.now() - started,
      },
      "payload_not_ok"
    );
    return { ok: false, skipped: true, updated: 0, message: msg };
  }

  if ("empty" in payload && payload.empty) {
    console.warn("[tefas-sync] TEFAS boş döndü, mevcut veri korunuyor.");
    await writeSyncLogSafe(
      {
        syncType: "TEFAS",
        status: "SKIPPED",
        fundsUpdated: 0,
        fundsCreated: 0,
        errorMessage: "empty_response",
        startedAt: new Date(started),
        completedAt: new Date(),
        durationMs: Date.now() - started,
      },
      "payload_empty"
    );
    return { ok: true, skipped: true, updated: 0, message: "empty" };
  }

  if (!payload.rows?.length) {
    return { ok: true, skipped: true, updated: 0, message: "no_rows" };
  }

  const typeId = await ensureFundTypes(payload.fundTypeCode ?? fundTypeCode);
  const now = new Date();
  const parsedSession = "date" in payload && payload.date ? parseTefasSessionDate(payload.date) : null;
  const sessionDayStart = startOfUtcDay(parsedSession ?? now);
  const existingFundsByCode = await loadExistingFundsForSync(payload.rows.map((row) => row.code));
  const recentHistoryByFundId = await loadRecentHistoryForSync(
    [...new Set([...existingFundsByCode.values()].map((row) => row.id))],
    sessionDayStart
  );

  let created = 0;
  let updatedRows = 0;

  const rows = payload.rows;
  const CHUNK = 100;
  const txOpts = { maxWait: 60_000, timeout: 180_000 };

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await prisma.$transaction(async (tx) => {
      for (const r of slice) {
        const existing = existingFundsByCode.get(r.code) ?? null;
        const dbPreviousClose = existing?.lastPrice ?? 0;

        let historyPreviousPrice = 0;
        let sameSessionPrice = 0;
        if (existing?.id) {
          const recentHistory = recentHistoryByFundId.get(existing.id) ?? [];
          const sessions = getDistinctHistorySessions(recentHistory);
          sameSessionPrice =
            sessions.find((session) => sameUtcDay(session.sessionDate, sessionDayStart))?.price ?? 0;
          historyPreviousPrice =
            sessions.find((session) => session.sessionDate.getTime() < sessionDayStart.getTime())?.price ?? 0;
        }

        const { dailyReturn, previousPrice } = computeFundDailyMetrics({
          apiDailyReturn: r.dailyReturn,
          lastPrice: r.lastPrice,
          rowPreviousPrice: r.previousPrice,
          dbPreviousClose,
          historyPreviousPrice,
          existingPreviousPrice: existing?.previousPrice ?? 0,
          existingDailyReturn: existing?.dailyReturn ?? 0,
          sameSessionPrice,
        });

        const fund = await tx.fund.upsert({
          where: { code: r.code },
          create: {
            code: r.code,
            name: r.name,
            shortName: r.shortName ?? r.code,
            lastPrice: r.lastPrice,
            previousPrice,
            dailyReturn,
            portfolioSize: r.portfolioSize,
            investorCount: r.investorCount,
            shareCount: r.shareCount,
            fundTypeId: typeId,
            lastUpdatedAt: now,
          },
          update: {
            name: r.name,
            shortName: r.shortName ?? r.code,
            lastPrice: r.lastPrice,
            previousPrice,
            dailyReturn,
            portfolioSize: r.portfolioSize,
            investorCount: r.investorCount,
            shareCount: r.shareCount,
            fundTypeId: typeId,
            lastUpdatedAt: now,
          },
        });
        if (existing) updatedRows += 1;
        else {
          created += 1;
          existingFundsByCode.set(r.code, {
            id: fund.id,
            code: r.code,
            lastPrice: r.lastPrice,
            previousPrice,
            dailyReturn,
          });
        }

        await tx.fundPriceHistory.upsert({
          where: { fundId_date: { fundId: fund.id, date: sessionDayStart } },
          create: {
            fundId: fund.id,
            date: sessionDayStart,
            price: r.lastPrice,
            dailyReturn,
            portfolioSize: r.portfolioSize,
            investorCount: r.investorCount,
          },
          update: {
            price: r.lastPrice,
            dailyReturn,
            portfolioSize: r.portfolioSize,
            investorCount: r.investorCount,
          },
        });

        if (fund.id) {
          const currentHistory = recentHistoryByFundId.get(fund.id) ?? [];
          currentHistory.unshift({
            id: `${fund.id}:${sessionDayStart.toISOString()}`,
            fundId: fund.id,
            date: sessionDayStart,
            price: r.lastPrice,
          });
          recentHistoryByFundId.set(fund.id, currentHistory.slice(0, 12));
        }
      }
    }, txOpts);
  }

  if (!skipDerivedRebuilds) {
    await recomputeFundReturnsFromHistory({ targetSessionDate: sessionDayStart });
    await rebuildMarketSnapshot(sessionDayStart);
    await rebuildFundDailySnapshots(sessionDayStart);
    try {
      const detailCore = await rebuildFundDetailCoreServingCache({ sourceDate: sessionDayStart });
      console.log("[tefas-sync] fund detail core serving rebuilt:", detailCore);
    } catch (e) {
      console.error("[tefas-sync] fund detail core serving rebuild failed:", e);
    }
    try {
      const derived = await rebuildFundDerivedMetrics();
      console.log("[tefas-sync] fund derived metrics:", derived);
    } catch (e) {
      console.error("[tefas-sync] fund derived metrics failed:", e);
    }
    await refreshFundHistorySyncState({
      phase: "daily_sync",
      sessionDate: sessionDayStart.toISOString(),
    });
    try {
      const warm = await warmAllScoresApiCaches();
      console.log("[tefas-sync] scores API cache warmed:", warm);
    } catch (e) {
      console.error("[tefas-sync] scores API cache warm failed:", e);
    }
  }

  let metadataNote = "";
  if (!skipMetadata) {
    try {
      const meta = await runTefasMetadataPass(prisma);
      metadataNote = ` | kategori+logo: ${JSON.stringify(meta)}`;
      console.log("[tefas-sync] Kategori/logo pass:", meta);
    } catch (e) {
      console.error("[tefas-sync] Kategori/logo pass hatası:", e);
      metadataNote = " | metadata_hata";
    }
  }

  await prisma.syncLog.create({
    data: {
      syncType: "TEFAS",
      status: "SUCCESS",
      fundsUpdated: updatedRows + created,
      fundsCreated: created,
      startedAt: new Date(started),
      completedAt: new Date(),
      durationMs: Date.now() - started,
    },
  });

  console.log(`[tefas-sync] Tamam: ${created} yeni, ${updatedRows} güncelleme.${metadataNote}`);
  return { ok: true, skipped: false, updated: payload.rows.length };
}

/** Yatırım (0) + BES (1) TEFAS çekimi; her turdan sonra kategori/logo pass. */
export async function runFullTefasSync(): Promise<TefasSyncResult & { types?: number[] }> {
  const types = [0, 1];
  let totalRows = 0;
  let lastError: string | undefined;
  let hardFailure = false;
  await withTefasBrowserClient(async (client) => {
    for (const fundTypeCode of types) {
      const r = await runTefasSync({ fundTypeCode, skipMetadata: true, skipDerivedRebuilds: true, client });
      totalRows += r.updated;
      if (!r.ok && !r.skipped) {
        throw new Error(r.message ?? `TEFAS sync failed for type ${fundTypeCode}`);
      }
      if (!r.ok && r.skipped) lastError = r.message;
    }
  }).catch((error) => {
    lastError = error instanceof Error ? error.message : String(error);
    hardFailure = true;
  });

  if (hardFailure) {
    return { ok: false, skipped: false, updated: totalRows, message: lastError, types };
  }
  if (lastError && totalRows === 0) {
    return { ok: false, skipped: true, updated: 0, message: lastError, types };
  }

  const postErrors: string[] = [];

  try {
    const meta = await runTefasMetadataPass(prisma);
    console.log("[tefas-sync] full sync metadata:", meta);
  } catch (e) {
    console.error("[tefas-sync] full sync metadata:", e);
  }

  try {
    const latestSession = await prisma.fundPriceHistory.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    });
    if (latestSession?.date) {
      const snapshotDate = startOfUtcDay(latestSession.date);
      await recomputeFundReturnsFromHistory({ targetSessionDate: snapshotDate });
      await rebuildMarketSnapshot(snapshotDate);
      const snapshot = await rebuildFundDailySnapshots(snapshotDate);
      console.log("[tefas-sync] daily snapshot rebuilt:", snapshot);
      try {
        const detailCore = await rebuildFundDetailCoreServingCache({ sourceDate: snapshotDate });
        console.log("[tefas-sync] fund detail core serving rebuilt:", detailCore);
      } catch (e) {
        console.error("[tefas-sync] fund detail core serving rebuild failed:", e);
        postErrors.push(`detail_core:${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (totalRows > 0) {
      postErrors.push("history_missing_latest_session");
    }
  } catch (e) {
    console.error("[tefas-sync] daily snapshot rebuild failed:", e);
    postErrors.push(`snapshot_pipeline:${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const derived = await rebuildFundDerivedMetrics();
    console.log("[tefas-sync] fund derived metrics:", derived);
  } catch (e) {
    console.error("[tefas-sync] fund derived metrics failed:", e);
    postErrors.push(`derived:${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const warm = await warmAllScoresApiCaches();
    console.log("[tefas-sync] scores API cache warmed:", warm);
  } catch (e) {
    console.error("[tefas-sync] scores API cache warm failed:", e);
    postErrors.push(`scores_warm:${e instanceof Error ? e.message : String(e)}`);
  }

  if (postErrors.length) {
    return {
      ok: false,
      skipped: false,
      updated: totalRows,
      types,
      message: `post_process_failed: ${postErrors.join(" | ")}`,
    };
  }

  return { ok: true, skipped: false, updated: totalRows, types };
}

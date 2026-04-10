/**
 * Günlük getiri onarımı:
 * 1) Mümkünse DB history'deki son iki gerçek oturumdan yeniden hesaplar.
 * 2) History yetersizse TEFAS'tan önceki + güncel iş gününü çekip backfill yapar.
 * 3) Piyasa özetini tekrar üretir.
 */
import "./load-env";
import { prisma } from "../src/lib/prisma";
import { TefasBrowserClient, withTefasBrowserClient, type TefasExportRow } from "../src/lib/services/tefas-browser.service";
import { rebuildMarketSnapshot, recomputeDailyReturnsFromHistory } from "../src/lib/services/tefas-sync.service";
import { fetchUsdTryEurTryLive } from "../src/lib/services/exchange-rates.service";
import { parseTefasSessionDate, startOfUtcDay } from "../src/lib/trading-calendar-tr";

const DAY_MS = 24 * 60 * 60 * 1000;
const TURKEY_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

function normalizeHistorySessionDate(date: Date): Date {
  return startOfUtcDay(new Date(date.getTime() + TURKEY_UTC_OFFSET_MS));
}

function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function getPreviousWorkday(d: Date): Date {
  const prev = new Date(d);
  prev.setDate(prev.getDate() - 1);
  while (prev.getDay() === 0 || prev.getDay() === 6) {
    prev.setDate(prev.getDate() - 1);
  }
  return prev;
}

async function getLatestDistinctHistorySessions(): Promise<Date[]> {
  const rawDates = await prisma.fundPriceHistory.groupBy({
    by: ["date"],
    _count: { _all: true },
    orderBy: { date: "desc" },
    take: 20,
  });

  const seen = new Set<number>();
  const distinct: Date[] = [];
  for (const row of rawDates) {
    const normalized = normalizeHistorySessionDate(row.date);
    const key = normalized.getTime();
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(normalized);
  }
  return distinct.sort((a, b) => b.getTime() - a.getTime());
}

async function fetchTefasData(client: TefasBrowserClient, date: string, fundType: 0 | 1): Promise<Map<string, TefasExportRow> | null> {
  try {
    const payload = await client.fetchPayload({ fundTypeCode: fundType, date });
    if (!payload.ok || ("empty" in payload && payload.empty) || !("rows" in payload)) return null;

    const map = new Map<string, TefasExportRow>();
    for (const row of payload.rows) {
      map.set(row.code, row);
    }
    return map;
  } catch (e) {
    console.error(`[daily-return] TEFAS fetch error (${date}, tür ${fundType}):`, e);
    return null;
  }
}

async function fetchTefasDataMerged(client: TefasBrowserClient, date: string): Promise<Map<string, TefasExportRow> | null> {
  const merged = new Map<string, TefasExportRow>();
  let any = false;
  for (const fundType of [0, 1] as const) {
    const part = await fetchTefasData(client, date, fundType);
    if (!part?.size) continue;
    any = true;
    for (const [code, row] of part) {
      merged.set(code, row);
    }
  }
  return any ? merged : null;
}

async function backfillFromTefasCompare(): Promise<{ updated: number; sessionDate: Date | null }> {
  const today = new Date();
  let currentDay = today;
  while (currentDay.getDay() === 0 || currentDay.getDay() === 6) {
    currentDay = new Date(currentDay.getTime() - DAY_MS);
  }
  const previousDay = getPreviousWorkday(currentDay);

  const currentDateStr = formatDate(currentDay);
  const previousDateStr = formatDate(previousDay);

  console.log(`[daily-return] TEFAS karşılaştırma: ${previousDateStr} -> ${currentDateStr}`);

  const [prevData, currData] = await withTefasBrowserClient(async (client) =>
    Promise.all([fetchTefasDataMerged(client, previousDateStr), fetchTefasDataMerged(client, currentDateStr)])
  );
  if (!prevData || !currData) {
    return { updated: 0, sessionDate: null };
  }

  const currentSessionDate = parseTefasSessionDate(currentDateStr);
  const previousSessionDate = parseTefasSessionDate(previousDateStr);
  if (!currentSessionDate || !previousSessionDate) {
    return { updated: 0, sessionDate: null };
  }

  const funds = await prisma.fund.findMany({
    where: { isActive: true, code: { in: [...currData.keys()] } },
    select: { id: true, code: true },
  });
  const fundByCode = new Map(funds.map((fund) => [fund.code, fund]));

  let updated = 0;
  for (const [code, curr] of currData) {
    const prev = prevData.get(code);
    const existing = fundByCode.get(code);
    if (!prev || !existing || prev.lastPrice <= 0 || curr.lastPrice <= 0) continue;

    const dailyReturn = Number((((curr.lastPrice - prev.lastPrice) / prev.lastPrice) * 100).toFixed(4));
    if (!Number.isFinite(dailyReturn) || Math.abs(dailyReturn) > 50) continue;

    await prisma.$transaction([
      prisma.fund.update({
        where: { id: existing.id },
        data: {
          lastPrice: curr.lastPrice,
          previousPrice: prev.lastPrice,
          dailyReturn,
          portfolioSize: curr.portfolioSize,
          investorCount: curr.investorCount,
          lastUpdatedAt: new Date(),
        },
      }),
      prisma.fundPriceHistory.upsert({
        where: { fundId_date: { fundId: existing.id, date: previousSessionDate } },
        create: {
          fundId: existing.id,
          date: previousSessionDate,
          price: prev.lastPrice,
          dailyReturn: 0,
          portfolioSize: prev.portfolioSize,
          investorCount: prev.investorCount,
        },
        update: {
          price: prev.lastPrice,
          portfolioSize: prev.portfolioSize,
          investorCount: prev.investorCount,
        },
      }),
      prisma.fundPriceHistory.upsert({
        where: { fundId_date: { fundId: existing.id, date: currentSessionDate } },
        create: {
          fundId: existing.id,
          date: currentSessionDate,
          price: curr.lastPrice,
          dailyReturn,
          portfolioSize: curr.portfolioSize,
          investorCount: curr.investorCount,
        },
        update: {
          price: curr.lastPrice,
          dailyReturn,
          portfolioSize: curr.portfolioSize,
          investorCount: curr.investorCount,
        },
      }),
    ]);

    updated += 1;
  }

  return { updated, sessionDate: currentSessionDate };
}

async function main() {
  const sessions = await getLatestDistinctHistorySessions();
  let updatedFromHistory = 0;
  let targetSessionDate = sessions[0] ?? startOfUtcDay(new Date());

  if (sessions.length >= 2) {
    const result = await recomputeDailyReturnsFromHistory({ targetSessionDate });
    updatedFromHistory = result.updatedFunds;
    console.log(`[daily-return] History recalculated: ${result.updatedFunds} funds, ${result.updatedHistoryRows} rows`);
  } else {
    console.log("[daily-return] Yeterli history yok, TEFAS compare fallback denenecek.");
  }

  let updatedFromCompare = 0;
  if (updatedFromHistory === 0) {
    const fallback = await backfillFromTefasCompare();
    updatedFromCompare = fallback.updated;
    if (fallback.sessionDate) targetSessionDate = fallback.sessionDate;
    console.log(`[daily-return] TEFAS compare backfill: ${updatedFromCompare} funds`);
  }

  await rebuildMarketSnapshot(targetSessionDate);

  const rates = await fetchUsdTryEurTryLive();
  if (rates) {
    await prisma.marketSnapshot.updateMany({
      where: { date: targetSessionDate },
      data: {
        usdTry: rates.usdTry,
        eurTry: rates.eurTry,
      },
    });
  }

  const [advancers, decliners, nonZero] = await Promise.all([
    prisma.fund.count({ where: { isActive: true, dailyReturn: { gt: 0 } } }),
    prisma.fund.count({ where: { isActive: true, dailyReturn: { lt: 0 } } }),
    prisma.fund.count({ where: { isActive: true, dailyReturn: { not: 0 } } }),
  ]);

  console.log(
    JSON.stringify(
      {
        sessionDate: targetSessionDate.toISOString(),
        updatedFromHistory,
        updatedFromCompare,
        advancers,
        decliners,
        nonZero,
      },
      null,
      2
    )
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});

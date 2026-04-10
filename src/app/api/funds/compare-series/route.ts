import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl, readCompareDataVersion } from "@/lib/data-freshness";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import { fetchKiyasMacroBuckets } from "@/lib/services/fund-detail-kiyas.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOOKBACK_DAYS = 1125;
const MAX_CODES = 3;
const DAY_MS = 86_400_000;
const CODE_RE = /^[A-Z0-9]{2,12}$/;

type Point = { t: number; v: number };

function parseCodes(raw: string | null): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[,\s]+/)
        .map((x) => x.trim().toUpperCase())
        .filter((x) => CODE_RE.test(x))
    ),
  ].slice(0, MAX_CODES);
}

function normalizeHistoryDate(date: Date): Date {
  return startOfUtcDay(new Date(date.getTime() + 3 * 60 * 60 * 1000));
}

function dedupePriceRows(rows: Array<{ date: Date; price: number }>): Point[] {
  const map = new Map<number, number>();
  for (const row of rows) {
    if (!Number.isFinite(row.price) || row.price <= 0) continue;
    map.set(normalizeHistoryDate(row.date).getTime(), row.price);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t, v }));
}

function buildCategorySeries(
  rows: Array<{ date: Date; _avg: { dailyReturn: number | null } }>
): Point[] {
  let index = 100;
  const out: Point[] = [];
  for (const row of rows) {
    const d = row._avg.dailyReturn;
    if (d == null || !Number.isFinite(d)) continue;
    index *= 1 + d / 100;
    out.push({ t: startOfUtcDay(row.date).getTime(), v: index });
  }
  return out;
}

async function getCompareSeriesPayload(baseCode: string, compareCodes: string[]) {
  const baseFund = await prisma.fund.findFirst({
    where: { code: baseCode },
    select: {
      id: true,
      code: true,
      name: true,
      category: { select: { code: true } },
    },
  });
  if (!baseFund) {
    return { error: "base_not_found" as const };
  }

  const selectedFunds = compareCodes.length
    ? await prisma.fund.findMany({
        where: {
          isActive: true,
          code: { in: compareCodes },
        },
        select: {
          id: true,
          code: true,
          name: true,
        },
      })
    : [];
  const byCode = new Map(selectedFunds.map((fund) => [fund.code.trim().toUpperCase(), fund]));
  const orderedSelected = compareCodes.map((code) => byCode.get(code)).filter(Boolean) as typeof selectedFunds;

  const anchor = startOfUtcDay(new Date());
  const from = new Date(anchor.getTime() - LOOKBACK_DAYS * DAY_MS);
  const fundIds = [baseFund.id, ...orderedSelected.map((fund) => fund.id)];

  const [historyRows, macroByRef, categoryAggRows] = await Promise.all([
    prisma.fundPriceHistory.findMany({
      where: { fundId: { in: fundIds }, date: { gte: from, lte: anchor } },
      orderBy: { date: "asc" },
      select: { fundId: true, date: true, price: true },
    }),
    fetchKiyasMacroBuckets(anchor),
    baseFund.category?.code
      ? prisma.fundDailySnapshot.groupBy({
          by: ["date"],
          where: {
            categoryCode: baseFund.category.code,
            fundId: { not: baseFund.id },
            date: { gte: from, lte: anchor },
          },
          _avg: { dailyReturn: true },
          orderBy: { date: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const historyByFund = new Map<string, Array<{ date: Date; price: number }>>();
  for (const row of historyRows) {
    const arr = historyByFund.get(row.fundId) ?? [];
    arr.push({ date: row.date, price: row.price });
    historyByFund.set(row.fundId, arr);
  }

  const fundSeries = [
    {
      key: `fund:${baseFund.code}`,
      label: `${baseFund.code} (Fon)`,
      code: baseFund.code,
      series: dedupePriceRows(historyByFund.get(baseFund.id) ?? []),
    },
    ...orderedSelected.map((fund) => ({
      key: `fund:${fund.code}`,
      label: `${fund.code}`,
      code: fund.code,
      series: dedupePriceRows(historyByFund.get(fund.id) ?? []),
    })),
  ];

  return {
    fundSeries,
    macroSeries: {
      category: buildCategorySeries(categoryAggRows),
      bist100: (macroByRef.bist100 ?? []).map((x) => ({ t: x.date.getTime(), v: x.value })),
      usdtry: (macroByRef.usdtry ?? []).map((x) => ({ t: x.date.getTime(), v: x.value })),
      eurtry: (macroByRef.eurtry ?? []).map((x) => ({ t: x.date.getTime(), v: x.value })),
      gold: (macroByRef.gold ?? []).map((x) => ({ t: x.date.getTime(), v: x.value })),
      policy: (macroByRef.policy ?? []).map((x) => ({ t: x.date.getTime(), v: x.value })),
    },
    labels: {
      category: "Kategori Ortalaması",
      bist100: "BIST 100",
      usdtry: "USD/TRY",
      eurtry: "EUR/TRY",
      gold: "Altın",
      policy: "Faiz / Para Piyasası Eşiği",
    },
  };
}

export async function GET(req: NextRequest) {
  try {
    const rawBaseCode = req.nextUrl.searchParams.get("base")?.trim().toUpperCase() ?? "";
    const baseCode = CODE_RE.test(rawBaseCode) ? rawBaseCode : "";
    if (!baseCode) {
      return NextResponse.json({ error: "base_required" }, { status: 400 });
    }
    const compareCodes = parseCodes(req.nextUrl.searchParams.get("codes")).filter((c) => c !== baseCode);

    const version = await readCompareDataVersion();
    const loadCached = unstable_cache(
      async () => getCompareSeriesPayload(baseCode, compareCodes),
      ["compare-series-v1", baseCode, compareCodes.join(","), version],
      { revalidate: LIVE_DATA_CACHE_SEC }
    );
    const payload = await loadCached();

    if ("error" in payload) {
      return NextResponse.json({ error: "base_not_found" }, { status: 404 });
    }

    return NextResponse.json(
      payload,
      {
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
        },
      }
    );
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[funds/compare-series]", error);
    }
    return NextResponse.json({ error: "compare_series_failed" }, { status: 500 });
  }
}

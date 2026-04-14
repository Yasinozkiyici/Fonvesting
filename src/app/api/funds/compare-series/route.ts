import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl, readCompareDataVersion } from "@/lib/data-freshness";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import { fetchKiyasMacroBuckets } from "@/lib/services/fund-detail-kiyas.service";
import {
  getFundDetailCoreServingCached,
  getFundDetailCoreServingUniversePayloads,
  type FundDetailCoreServingPayload,
} from "@/lib/services/fund-detail-core-serving.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOOKBACK_DAYS = 1125;
const MAX_CODES = 3;
const DAY_MS = 86_400_000;
const MAX_REF_SNAPSHOT_LAG_DAYS = 1;
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

function buildCategorySeries(rows: Array<{ date: Date; _avg: { dailyReturn: number | null } }>): Point[] {
  let index = 100;
  const out: Point[] = [];
  for (const row of rows) {
    const d = row._avg.dailyReturn;
    if (d == null || !Number.isFinite(d)) continue;
    index *= 1 + d / 100;
    out.push({ t: normalizeHistoryDate(row.date).getTime(), v: index });
  }
  return out;
}

function pointsFromServingPayload(payload: FundDetailCoreServingPayload): Point[] {
  const rows = payload.chartHistory?.points ?? [];
  const map = new Map<number, number>();
  for (const row of rows) {
    if (!Number.isFinite(row?.t) || !Number.isFinite(row?.p) || row.p <= 0) continue;
    map.set(normalizeHistoryDate(new Date(row.t)).getTime(), row.p);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t, v }));
}

function buildCategorySeriesFromServingPayloads(
  base: FundDetailCoreServingPayload,
  universe: FundDetailCoreServingPayload[]
): Point[] {
  const categoryCode = base.fund.categoryCode;
  if (!categoryCode) return [];
  const baseCode = base.fund.code.trim().toUpperCase();
  const byDate = new Map<number, { sum: number; count: number }>();
  let contributors = 0;
  for (const payload of universe) {
    if (payload.fund.code.trim().toUpperCase() === baseCode) continue;
    if (payload.fund.categoryCode !== categoryCode) continue;
    const series = pointsFromServingPayload(payload);
    if (series.length < 2) continue;
    contributors += 1;
    for (let index = 1; index < series.length; index += 1) {
      const prev = series[index - 1]!;
      const curr = series[index]!;
      if (!(prev.v > 0)) continue;
      const dailyReturnPct = ((curr.v - prev.v) / prev.v) * 100;
      if (!Number.isFinite(dailyReturnPct)) continue;
      const slot = byDate.get(curr.t) ?? { sum: 0, count: 0 };
      slot.sum += dailyReturnPct;
      slot.count += 1;
      byDate.set(curr.t, slot);
    }
  }
  if (contributors === 0 || byDate.size === 0) return [];
  const sorted = [...byDate.entries()].sort((a, b) => a[0] - b[0]);
  let index = 100;
  const out: Point[] = [];
  for (const [t, agg] of sorted) {
    if (agg.count <= 0) continue;
    index *= 1 + agg.sum / agg.count / 100;
    out.push({ t, v: index });
  }
  return out;
}

async function getCompareSeriesPayload(baseCode: string, compareCodes: string[]) {
  const baseRead = await getFundDetailCoreServingCached(baseCode, { preferFileOnly: true });
  if (!baseRead.payload) {
    return { error: "base_not_found" as const };
  }
  const baseFund = baseRead.payload;
  const baseSnapshotMs = Date.parse(baseFund.latestSnapshotDate ?? "");
  const selectedReads = await Promise.all(
    compareCodes.map((code) => getFundDetailCoreServingCached(code, { preferFileOnly: true }))
  );
  const orderedSelected = selectedReads
    .map((read) => read.payload)
    .filter((payload): payload is FundDetailCoreServingPayload => payload != null)
    .filter((payload) => {
      if (!Number.isFinite(baseSnapshotMs)) return true;
      const refMs = Date.parse(payload.latestSnapshotDate ?? "");
      if (!Number.isFinite(refMs)) return false;
      const lagDays = Math.floor((baseSnapshotMs - refMs) / DAY_MS);
      const keep = lagDays <= MAX_REF_SNAPSHOT_LAG_DAYS;
      if (!keep) {
        console.info(
          `[compare-series-stale-guard] base=${baseFund.fund.code} ref=${payload.fund.code} base_snapshot=${baseFund.latestSnapshotDate ?? "none"} ` +
            `ref_snapshot=${payload.latestSnapshotDate ?? "none"} lag_days=${lagDays} decision=drop`
        );
      }
      return keep;
    });

  const anchor = startOfUtcDay(new Date());
  const shouldBuildCategoryFromUniverse = compareCodes.length > 0;
  const [macroByRef, servingUniverse] = await Promise.all([
    fetchKiyasMacroBuckets(anchor),
    shouldBuildCategoryFromUniverse ? getFundDetailCoreServingUniversePayloads() : Promise.resolve(null),
  ]);

  const fundSeries = [
    {
      key: `fund:${baseFund.fund.code}`,
      label: `${baseFund.fund.code} (Fon)`,
      code: baseFund.fund.code,
      series: pointsFromServingPayload(baseFund),
    },
    ...orderedSelected.map((fund) => ({
      key: `fund:${fund.fund.code}`,
      label: `${fund.fund.code}`,
      code: fund.fund.code,
      series: pointsFromServingPayload(fund),
    })),
  ];
  console.info(
    `[compare-series-stale-guard] base=${baseFund.fund.code} base_snapshot=${baseFund.latestSnapshotDate ?? "none"} ` +
      `requested_refs=${compareCodes.length} accepted_refs=${Math.max(0, fundSeries.length - 1)} lag_threshold_days=${MAX_REF_SNAPSHOT_LAG_DAYS}`
  );

  return {
    fundSeries,
    macroSeries: {
      category:
        shouldBuildCategoryFromUniverse && servingUniverse
          ? buildCategorySeriesFromServingPayloads(baseFund, servingUniverse.records)
          : [],
      bist100: (macroByRef.bist100 ?? []).map((x) => ({ t: normalizeHistoryDate(x.date).getTime(), v: x.value })),
      usdtry: (macroByRef.usdtry ?? []).map((x) => ({ t: normalizeHistoryDate(x.date).getTime(), v: x.value })),
      eurtry: (macroByRef.eurtry ?? []).map((x) => ({ t: normalizeHistoryDate(x.date).getTime(), v: x.value })),
      gold: (macroByRef.gold ?? []).map((x) => ({ t: normalizeHistoryDate(x.date).getTime(), v: x.value })),
      policy: (macroByRef.policy ?? []).map((x) => ({ t: normalizeHistoryDate(x.date).getTime(), v: x.value })),
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

    // Compare payload'da özellikle geçmiş backfill sonrası stale sonuç istemiyoruz.
    // Versiyon yine okunur; yanıt HTTP cache başlıklarıyla CDN katmanında korunur.
    await readCompareDataVersion();
    const payload = await getCompareSeriesPayload(baseCode, compareCodes);

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

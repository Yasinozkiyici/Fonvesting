import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl, readCompareDataVersion } from "@/lib/data-freshness";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import { fetchKiyasMacroBuckets } from "@/lib/services/fund-detail-kiyas.service";
import {
  normalizeBaseCode,
  parseCompareCodes,
  readServingPayloadForCompareSeries,
  isTransientCompareBaseMissReason,
  type CompareServingReaderLike,
} from "@/lib/services/compare-series-resolution";
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
const COMPARE_SERIES_VERSION_TIMEOUT_MS = Number(process.env.COMPARE_SERIES_VERSION_TIMEOUT_MS ?? "1000");
const COMPARE_SERIES_MACRO_TIMEOUT_MS = Number(process.env.COMPARE_SERIES_MACRO_TIMEOUT_MS ?? "2200");
const COMPARE_SERIES_UNIVERSE_TIMEOUT_MS = Number(process.env.COMPARE_SERIES_UNIVERSE_TIMEOUT_MS ?? "2200");
const COMPARE_SERIES_SECONDARY_TIMEOUT_MS = Number(process.env.COMPARE_SERIES_SECONDARY_TIMEOUT_MS ?? "1600");

type Point = { t: number; v: number };

type CompareSeriesPayload = {
  fundSeries: Array<{ key: string; label: string; code: string; series: Point[] }>;
  macroSeries: {
    category: Point[];
    bist100: Point[];
    usdtry: Point[];
    eurtry: Point[];
    gold: Point[];
    policy: Point[];
  };
  labels: {
    category: string;
    bist100: string;
    usdtry: string;
    eurtry: string;
    gold: string;
    policy: string;
  };
};

type CompareSeriesBuildResult = {
  payload: CompareSeriesPayload;
  degraded: boolean;
  degradedSources: string[];
  failureClass: string[];
};

type CompareSeriesBaseError = {
  error: "base_not_found" | "base_temporarily_unavailable";
  failureClass: string[];
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout_${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isTimeoutLike(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|aborted/i.test(message);
}

type CompareServingRead = Awaited<ReturnType<typeof getFundDetailCoreServingCached>>;
type CompareServingReader = CompareServingReaderLike<FundDetailCoreServingPayload>;

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

async function getCompareSeriesPayload(
  baseCode: string,
  compareCodes: string[],
  deps?: {
    readServing?: CompareServingReader;
    fetchMacro?: typeof fetchKiyasMacroBuckets;
    readUniverse?: typeof getFundDetailCoreServingUniversePayloads;
  }
): Promise<CompareSeriesBuildResult | CompareSeriesBaseError> {
  const readServing = deps?.readServing ?? getFundDetailCoreServingCached;
  const fetchMacro = deps?.fetchMacro ?? fetchKiyasMacroBuckets;
  const readUniverse = deps?.readUniverse ?? getFundDetailCoreServingUniversePayloads;
  const baseRead = await readServingPayloadForCompareSeries(baseCode, readServing).catch((error) => ({
    payload: null,
    missReason: isTimeoutLike(error) ? "read_timeout" : "read_failed",
  }));
  if (!baseRead.payload) {
    const missReason = baseRead.missReason ?? "";
    if (isTransientCompareBaseMissReason(missReason)) {
      return {
        error: "base_temporarily_unavailable",
        failureClass: [missReason === "read_timeout" ? "timeout" : "base_read_failed"],
      };
    }
    return { error: "base_not_found", failureClass: [] };
  }
  const baseFund = baseRead.payload;
  const failureClass: string[] = [];
  const degradedSources: string[] = [];
  const baseSnapshotMs = Date.parse(baseFund.latestSnapshotDate ?? "");
  const selectedReads = await Promise.all(
    compareCodes.map(async (code) => {
      try {
        return await withTimeout(
          readServingPayloadForCompareSeries(code, readServing),
          COMPARE_SERIES_SECONDARY_TIMEOUT_MS,
          "compare_series_secondary_read"
        );
      } catch (error) {
        degradedSources.push(`secondary:${code}`);
        failureClass.push(isTimeoutLike(error) ? "timeout" : "secondary_read_failed");
        return { payload: null };
      }
    })
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
    withTimeout(fetchMacro(anchor), COMPARE_SERIES_MACRO_TIMEOUT_MS, "compare_series_macro").catch((error) => {
      degradedSources.push("macro");
      failureClass.push(isTimeoutLike(error) ? "timeout" : "macro_failed");
      return {
        category: [],
        bist100: [],
        usdtry: [],
        eurtry: [],
        gold: [],
        policy: [],
      };
    }),
    shouldBuildCategoryFromUniverse
      ? withTimeout(
        readUniverse(),
        COMPARE_SERIES_UNIVERSE_TIMEOUT_MS,
        "compare_series_universe"
      ).catch((error) => {
        degradedSources.push("category_universe");
        failureClass.push(isTimeoutLike(error) ? "timeout" : "universe_failed");
        return null;
      })
      : Promise.resolve(null),
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

  const payload: CompareSeriesPayload = {
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
  return {
    payload,
    degraded: degradedSources.length > 0 || failureClass.length > 0,
    degradedSources: [...new Set(degradedSources)],
    failureClass: [...new Set(failureClass)],
  } as CompareSeriesBuildResult;
}

export async function GET(req: NextRequest) {
  try {
    const baseCode = normalizeBaseCode(req.nextUrl.searchParams.get("base"));
    if (!baseCode) {
      return NextResponse.json({ error: "base_required" }, { status: 400 });
    }
    const compareCodes = parseCompareCodes(req.nextUrl.searchParams.get("codes"), {
      maxCodes: MAX_CODES,
      codeRe: CODE_RE,
    }).filter((c) => c !== baseCode);

    // Compare payload'da özellikle geçmiş backfill sonrası stale sonuç istemiyoruz.
    // Versiyon yine okunur; yanıt HTTP cache başlıklarıyla CDN katmanında korunur.
    await withTimeout(readCompareDataVersion(), COMPARE_SERIES_VERSION_TIMEOUT_MS, "compare_series_version").catch(() => null);
    const result = await getCompareSeriesPayload(baseCode, compareCodes);

    if ("error" in result) {
      const status = result.error === "base_not_found" ? 404 : 503;
      return NextResponse.json(
        { error: result.error },
        {
          status,
          headers: result.failureClass.length
            ? { "X-Compare-Series-Failure-Class": result.failureClass.join(",") }
            : undefined,
        }
      );
    }

    return NextResponse.json(
      result.payload,
      {
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
          ...(result.degraded ? { "X-Compare-Series-Degraded": "1" } : {}),
          ...(result.degradedSources.length
            ? { "X-Compare-Series-Degraded-Source": result.degradedSources.join(",") }
            : {}),
          ...(result.failureClass.length
            ? { "X-Compare-Series-Failure-Class": result.failureClass.join(",") }
            : {}),
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

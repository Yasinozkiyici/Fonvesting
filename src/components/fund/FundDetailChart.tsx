"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import {
  formatChartAxisPercentTick,
  formatChartAxisPriceTick,
  formatDetailAbsolutePercent,
  formatDetailDeltaPercent,
  formatDetailPeriodReturnPercent,
} from "@/lib/fund-detail-format";
import {
  addCompareCode,
  COMPARE_CODES_CHANGED_EVENT,
  COMPARE_STORAGE_KEY,
  readCompareCodes,
  removeCompareCode,
} from "@/lib/compare-selection";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";
import type { KiyasPeriodId, KiyasRefKey } from "@/lib/services/fund-detail-kiyas.service";
import {
  BENCHMARK_COMPARISON_TIE_EPS_PP,
  buildBenchmarkComparisonView,
  summarizeBenchmarkComparisonViewForDev,
  type BenchmarkComparisonOutcome,
  type BenchmarkComparisonRow,
} from "@/lib/fund-detail-comparison";
import { deriveFundDetailBehaviorContract, shouldRenderSectionFromContract } from "@/lib/fund-detail-section-status";
import {
  buildLinearClosedAreaPathD,
  buildLinearPathD,
  dedupeChartPointsByX,
  type ChartPathPoint,
} from "@/lib/chart-monotone-path";

const DAY_MS = 86400000;

const RANGES = [
  { id: "1m", label: "1A", days: 31 },
  { id: "3m", label: "3A", days: 93 },
  { id: "6m", label: "6A", days: 186 },
  { id: "1y", label: "1Y", days: 365 },
  { id: "3y", label: "3Y", days: 1095 },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

const VB_W = 860;
const VB_H = 182;
const PAD_L = 56;
const PAD_R = 14;
const PAD_T = 7;
const PAD_B = 28;
const PLOT_LEFT = PAD_L;
const PLOT_RIGHT = VB_W - PAD_R;
const PLOT_TOP = PAD_T;
const PLOT_BOTTOM = VB_H - PAD_B;
const INNER_W = PLOT_RIGHT - PLOT_LEFT;
const INNER_H = PLOT_BOTTOM - PLOT_TOP;
const X_LABEL_Y = PLOT_BOTTOM + 12;
const DELTA_NEAR_EPS = BENCHMARK_COMPARISON_TIE_EPS_PP;
const BENCHMARK_REF_ORDER: KiyasRefKey[] = ["category", "bist100", "usdtry", "eurtry", "gold", "policy"];

type Point = { t: number; v: number };

/**
 * Kıyas makro serileri iki kaynaktan gelebilir:
 * - sunucu `kiyasBlock.chartMacroByRef` (sayfa yüküyle birlikte)
 * - istemci `/api/funds/compare-series` (güncel karşılaştırma payload'ı)
 * Kaynaklar farklı anchor/yoğunluk taşıyabildiği için güvenilirlik adına birleştirilir.
 */
function pickBenchmarkMacroSeries(
  server: Point[] | undefined,
  client: Point[] | undefined
): Point[] {
  const srcA = Array.isArray(server) ? server : [];
  const srcB = Array.isArray(client) ? client : [];
  if (srcA.length === 0 && srcB.length === 0) return [];
  if (srcA.length === 0) return srcB;
  if (srcB.length === 0) return srcA;

  const merged = new Map<number, number>();
  for (const point of srcA) {
    if (!Number.isFinite(point.t) || !Number.isFinite(point.v)) continue;
    merged.set(point.t, point.v);
  }
  // Aynı timestamp'te istemci payload'ı daha güncel kabul edilir.
  for (const point of srcB) {
    if (!Number.isFinite(point.t) || !Number.isFinite(point.v)) continue;
    merged.set(point.t, point.v);
  }
  return [...merged.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t, v }));
}

function kiyasBlockHasComparableRows(data: FundDetailPageData): boolean {
  const rowsByRef = data.kiyasBlock?.rowsByRef;
  if (!rowsByRef) return false;
  return Object.values(rowsByRef).some((rows) =>
    rows.some((row) => Number.isFinite(row.fundPct) && Number.isFinite(row.refPct))
  );
}

const COMPARISON_VISUALS: Record<
  string,
  {
    tone: string;
    surface: string;
    border: string;
  }
> = {
  fund: {
    tone: "var(--accent-blue)",
    surface: "color-mix(in srgb, var(--accent-blue) 4%, var(--card-bg))",
    border: "color-mix(in srgb, var(--accent-blue) 18%, var(--border-subtle))",
  },
  category: {
    tone: "#8091ad",
    surface: "color-mix(in srgb, #8091ad 6%, var(--card-bg))",
    border: "color-mix(in srgb, #8091ad 18%, var(--border-subtle))",
  },
  bist100: {
    tone: "#6d80a6",
    surface: "color-mix(in srgb, #6d80a6 6%, var(--card-bg))",
    border: "color-mix(in srgb, #6d80a6 18%, var(--border-subtle))",
  },
  usdtry: {
    tone: "#b58b61",
    surface: "color-mix(in srgb, #b58b61 7%, var(--card-bg))",
    border: "color-mix(in srgb, #b58b61 18%, var(--border-subtle))",
  },
  eurtry: {
    tone: "#7ca29a",
    surface: "color-mix(in srgb, #7ca29a 7%, var(--card-bg))",
    border: "color-mix(in srgb, #7ca29a 18%, var(--border-subtle))",
  },
  gold: {
    tone: "#b69a63",
    surface: "color-mix(in srgb, #b69a63 7%, var(--card-bg))",
    border: "color-mix(in srgb, #b69a63 18%, var(--border-subtle))",
  },
  policy: {
    tone: "#879387",
    surface: "color-mix(in srgb, #879387 6%, var(--card-bg))",
    border: "color-mix(in srgb, #879387 18%, var(--border-subtle))",
  },
};

function comparisonOutcomeLabel(outcome: BenchmarkComparisonOutcome): "Geçti" | "Geride" | "Başa baş" | "Veri yetersiz" {
  if (outcome === "outperform") return "Geçti";
  if (outcome === "underperform") return "Geride";
  if (outcome === "insufficient_data") return "Veri yetersiz";
  return "Başa baş";
}

function periodIdForRange(range: RangeId): KiyasPeriodId {
  if (range === "1m" || range === "3m" || range === "6m" || range === "1y" || range === "3y") return range;
  return "1y";
}

function periodLabelForRange(range: RangeId): string {
  if (range === "1m") return "1 Ay";
  if (range === "3m") return "3 Ay";
  if (range === "6m") return "6 Ay";
  if (range === "1y") return "1 Yıl";
  return "3 Yıl";
}

function comparisonDeltaTone(delta: number | null | undefined): string {
  if (delta == null || !Number.isFinite(delta)) return "var(--text-secondary)";
  if (Math.abs(delta) <= DELTA_NEAR_EPS) return "var(--text-secondary)";
  return delta > 0 ? "var(--success-muted)" : "var(--danger-muted, #b91c1c)";
}

function detailHistorySourceFromData(data: FundDetailPageData): "history" | "snapshot_fallback" | "approx" | "serving" | "unknown" {
  const reasons = data.degraded?.reasons ?? [];
  if (reasons.includes("core_price_series_source_history")) return "history";
  if (reasons.includes("core_price_series_source_snapshot_fallback")) return "snapshot_fallback";
  if (reasons.includes("core_price_series_source_approx")) return "approx";
  if (reasons.includes("core_price_series_source_serving")) return "serving";
  return "unknown";
}

/** Ana özet kartı — öncelikli referans adı (kısa). */
function primaryComparisonCaption(label: string): string {
  return label;
}

function formatLongDate(t: number): string {
  return new Date(t).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
}

function filterWindow<T extends { t: number }>(series: T[], rangeId: RangeId, anchorT?: number): T[] {
  if (series.length === 0) return [];
  const cfg = RANGES.find((r) => r.id === rangeId);
  if (!cfg || cfg.days == null) return series;
  const lastT = anchorT ?? series[series.length - 1]!.t;
  const minT = lastT - cfg.days * DAY_MS;
  const win = series.filter((x) => x.t >= minT);
  return win.length >= 2 ? win : series;
}

function sortSeriesAsc(series: Point[]): Point[] {
  const sorted = [...series]
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.v) && point.v > 0)
    .sort((a, b) => a.t - b.t);
  const out: Point[] = [];
  for (const point of sorted) {
    if (out.length > 0 && out[out.length - 1]!.t === point.t) {
      out[out.length - 1] = point;
    } else {
      out.push(point);
    }
  }
  return out;
}

function indexOnOrBefore(series: Point[], t: number): number {
  if (series.length === 0) return -1;
  let lo = 0;
  let hi = series.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid]!.t <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function normalizeSeriesInRange(series: Point[], startT: number, endT: number): Point[] | null {
  if (!Number.isFinite(startT) || !Number.isFinite(endT) || endT <= startT) return null;
  const sorted = sortSeriesAsc(series);
  if (sorted.length < 2) return null;
  const startIndex = indexOnOrBefore(sorted, startT);
  const endIndex = indexOnOrBefore(sorted, endT);
  if (startIndex < 0 || endIndex < 0 || startIndex === endIndex) return null;
  const startValue = sorted[startIndex]!.v;
  if (!Number.isFinite(startValue) || startValue <= 0) return null;
  return sorted.slice(startIndex, endIndex + 1).map((point) => ({
    t: point.t,
    v: ((point.v / startValue) - 1) * 100,
  }));
}

function fmtChartAxisPrice(n: number): string {
  const s = formatChartAxisPriceTick(n);
  return s === "—" ? s : `₺${s}`;
}

function fmtAxisDateShort(t: number): string {
  return new Date(t).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

function mapSeriesToChartXY(points: Point[], tMin: number, tMax: number, min: number, max: number): ChartPathPoint[] {
  const span = max - min || 1;
  const tSpan = tMax - tMin || 1;
  return points.map((p) => ({
    x: PLOT_LEFT + ((p.t - tMin) / tSpan) * INNER_W,
    y: PLOT_TOP + INNER_H - ((p.v - min) / span) * INNER_H,
  }));
}

/** Stabil çizim: doğrusal segmentler + round cap/join; tüm düğümler korunur, spline artefaktı yok. */
function buildPerformanceLinePath(points: Point[], tMin: number, tMax: number, min: number, max: number): string | null {
  const xy = dedupeChartPointsByX(mapSeriesToChartXY(points, tMin, tMax, min, max));
  return buildLinearPathD(xy);
}

function buildPerformanceAreaPath(points: Point[], tMin: number, tMax: number, min: number, max: number): string | null {
  const xy = dedupeChartPointsByX(mapSeriesToChartXY(points, tMin, tMax, min, max));
  return buildLinearClosedAreaPathD(xy, PLOT_BOTTOM);
}

function yLevelsForScale(min: number, max: number, fmtY: (n: number) => string): Array<{ y: number; label: string }> {
  const span = max - min || 1;
  const midVal = min + span / 2;
  return [
    {
      y: PLOT_TOP + INNER_H - ((max - min) / span) * INNER_H,
      label: fmtY(max),
    },
    {
      y: PLOT_TOP + INNER_H - ((midVal - min) / span) * INNER_H,
      label: fmtY(midVal),
    },
    {
      y: PLOT_TOP + INNER_H,
      label: fmtY(min),
    },
  ];
}

type Props = {
  data: FundDetailPageData;
};

export function FundDetailChart({ data }: Props) {
  const fundAreaGradId = useId().replace(/:/g, "");
  const fundSeries = useMemo<Point[]>(
    () => sortSeriesAsc(data.priceSeries.map((x) => ({ t: x.t, v: x.p }))),
    [data.priceSeries]
  );
  const [range, setRange] = useState<RangeId>("1y");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const chartSvgRef = useRef<SVGSVGElement | null>(null);
  const [hoverState, setHoverState] = useState<{ x: number; point: Point } | null>(null);
  const [compareData, setCompareData] = useState<{
    fundSeries: Array<{ key: string; label: string; code: string; series: Point[] }>;
    macroSeries: Record<string, Point[]>;
    labels: Record<string, string>;
  } | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [comparisonExpanded, setComparisonExpanded] = useState(false);
  const [showCompareControls, setShowCompareControls] = useState(false);
  const [fundOnCompare, setFundOnCompare] = useState(false);
  const compareRequestRef = useRef<Promise<void> | null>(null);
  const compareAbortRef = useRef<AbortController | null>(null);
  const compareDataRef = useRef<typeof compareData>(null);
  const compareFetchSignatureRef = useRef<string>("");
  const compareFetchAtRef = useRef(0);
  const compareAutoPrefetchAttemptRef = useRef(0);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const behavior = useMemo(() => deriveFundDetailBehaviorContract(data), [data]);
  const serverKiyasHasComparableRows = useMemo(() => kiyasBlockHasComparableRows(data), [data]);
  const compareDebugRenderCountRef = useRef(0);

  useEffect(() => {
    compareDataRef.current = compareData;
  }, [compareData]);

  useLayoutEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => {
      const next = mq.matches;
      try {
        document.documentElement.setAttribute("data-viewport-narrow", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      setIsNarrowViewport(next);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const loadCompareData = useCallback(async () => {
    if (compareRequestRef.current) {
      await compareRequestRef.current;
    }

    const codes = readCompareCodes().filter((c) => c !== data.fund.code).slice(0, 3);
    const signature = `${data.fund.code}|${codes.join(",")}`;
    const now = Date.now();
    if (
      compareFetchSignatureRef.current === signature &&
      now - compareFetchAtRef.current < 1200
    ) {
      // Aynı imza ile milisaniye düzeyinde tekrar fetch etmeyelim (event fırtınası guard).
      return;
    }
    compareFetchSignatureRef.current = signature;
    compareFetchAtRef.current = now;
    const qs = new URLSearchParams({
      base: data.fund.code,
      codes: codes.join(","),
    });

    setCompareLoading(true);
    compareAbortRef.current?.abort();
    const controller = new AbortController();
    compareAbortRef.current = controller;
    const timeoutMs = 6_000;
    const timeoutId = setTimeout(() => {
      controller.abort(new DOMException(`compare_series_timeout_${timeoutMs}ms`, "AbortError"));
    }, timeoutMs);
    compareRequestRef.current = fetch(`/api/funds/compare-series?${qs.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          if (!controller.signal.aborted) setCompareData(null);
          return;
        }
        const body = await res.json();
        if (!controller.signal.aborted) {
          setCompareData(body);
        }
      })
      .catch((error) => {
        if ((error as Error)?.name !== "AbortError" && process.env.NODE_ENV !== "production") {
          console.error("[fund-detail-compare-series]", error);
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (compareAbortRef.current === controller) {
          compareAbortRef.current = null;
        }
        compareRequestRef.current = null;
        if (!controller.signal.aborted) {
          setCompareLoading(false);
        }
      });

    await compareRequestRef.current;
  }, [data.fund.code]);

  useEffect(() => {
    const syncFundSelection = () => {
      setFundOnCompare(readCompareCodes().includes(data.fund.code));
    };

    syncFundSelection();
    setCompareData(null);
    compareAutoPrefetchAttemptRef.current = 0;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== COMPARE_STORAGE_KEY) return;
      syncFundSelection();
      if (compareDataRef.current) void loadCompareData();
    };
    const onCompareChange = () => {
      syncFundSelection();
      if (compareDataRef.current) void loadCompareData();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(COMPARE_CODES_CHANGED_EVENT, onCompareChange);
    return () => {
      compareAbortRef.current?.abort();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(COMPARE_CODES_CHANGED_EVENT, onCompareChange);
    };
  }, [data.fund.code, loadCompareData]);

  useEffect(() => {
    if (serverKiyasHasComparableRows) return;
    if (compareData || compareLoading) return;
    if (compareAutoPrefetchAttemptRef.current >= 2) return;
    compareAutoPrefetchAttemptRef.current += 1;
    const waitMs = compareAutoPrefetchAttemptRef.current === 1 ? 0 : 1200;
    const timer = setTimeout(() => {
      void loadCompareData();
    }, waitMs);
    return () => clearTimeout(timer);
  }, [compareData, compareLoading, loadCompareData, serverKiyasHasComparableRows]);

  const handleCurrentFundCompareToggle = () => {
    if (fundOnCompare) {
      removeCompareCode(data.fund.code);
      setFundOnCompare(false);
      return;
    }
    addCompareCode(data.fund.code);
    setFundOnCompare(true);
  };

  const chartMacro = data.kiyasBlock?.chartMacroByRef;
  const rawSeriesMap = useMemo<Record<string, Point[]>>(() => {
    const map: Record<string, Point[]> = {
      fund: fundSeries,
      category: compareData?.macroSeries?.category ?? [],
      bist100: pickBenchmarkMacroSeries(chartMacro?.bist100, compareData?.macroSeries?.bist100),
      usdtry: pickBenchmarkMacroSeries(chartMacro?.usdtry, compareData?.macroSeries?.usdtry),
      eurtry: pickBenchmarkMacroSeries(chartMacro?.eurtry, compareData?.macroSeries?.eurtry),
      gold: pickBenchmarkMacroSeries(chartMacro?.gold, compareData?.macroSeries?.gold),
      policy: pickBenchmarkMacroSeries(chartMacro?.policy, compareData?.macroSeries?.policy),
    };
    for (const f of compareData?.fundSeries ?? []) {
      map[f.key] = f.series;
    }
    return map;
  }, [chartMacro, compareData, fundSeries]);

  const anchorT = fundSeries[fundSeries.length - 1]?.t;
  const fundWindow = useMemo(() => filterWindow(fundSeries, range), [fundSeries, range]);
  const chartWindow = useMemo(() => filterWindow(fundSeries, range, anchorT), [fundSeries, range, anchorT]);
  useEffect(() => {
    const payloadMin = fundSeries[0]?.t ?? null;
    const payloadMax = fundSeries[fundSeries.length - 1]?.t ?? null;
    const renderedMin = chartWindow[0]?.t ?? null;
    const renderedMax = chartWindow[chartWindow.length - 1]?.t ?? null;
    const historySource = detailHistorySourceFromData(data);
    const shortFallbackUsed =
      historySource === "snapshot_fallback" || historySource === "approx" || historySource === "serving";
    console.info(
      `[detail-history-render] code=${data.fund.code} range=${range} detail_history_payload_min_date=${
        payloadMin ? new Date(payloadMin).toISOString() : "none"
      } detail_history_payload_max_date=${payloadMax ? new Date(payloadMax).toISOString() : "none"} ` +
        `detail_history_rendered_points=${chartWindow.length} detail_history_rendered_min_date=${
          renderedMin ? new Date(renderedMin).toISOString() : "none"
        } detail_history_rendered_max_date=${renderedMax ? new Date(renderedMax).toISOString() : "none"} ` +
        `detail_history_source=${historySource} detail_history_short_fallback_used=${shortFallbackUsed ? 1 : 0}`
    );
  }, [chartWindow, data, fundSeries, range]);
  const comparisonStartT = fundWindow[0]?.t ?? 0;
  const comparisonEndT = fundWindow[fundWindow.length - 1]?.t ?? 0;
  const benchmarkLabels = useMemo<Record<KiyasRefKey, string>>(
    () => ({
      category: compareData?.labels?.category ?? "Kategori Ortalaması",
      bist100: compareData?.labels?.bist100 ?? "BIST 100",
      usdtry: compareData?.labels?.usdtry ?? "USD/TRY",
      eurtry: compareData?.labels?.eurtry ?? "EUR/TRY",
      gold: compareData?.labels?.gold ?? "Altın",
      policy: compareData?.labels?.policy ?? "Faiz / Para Piyasası Eşiği",
    }),
    [compareData?.labels]
  );
  const benchmarkAvailability = useMemo(() => {
    const out: Partial<Record<KiyasRefKey, boolean>> = {};
    for (const key of BENCHMARK_REF_ORDER) {
      const normalized = normalizeSeriesInRange(rawSeriesMap[key] ?? [], comparisonStartT, comparisonEndT);
      out[key] = Boolean(normalized && normalized.length >= 2);
    }
    return out;
  }, [comparisonEndT, comparisonStartT, rawSeriesMap]);

  const availableItems = useMemo<
    Array<{ key: string; label: string; kind: "benchmark" | "fund"; available: boolean }>
  >(() => {
    const benchmarkItems = BENCHMARK_REF_ORDER.map((key) => ({
      key,
      label: benchmarkLabels[key],
      kind: "benchmark" as const,
      available: benchmarkAvailability[key] === true,
    }));
    const fundItems =
      compareData?.fundSeries
        .filter((series) => series.code !== data.fund.code)
        .map((series) => ({
          key: series.key,
          label: series.label,
          kind: "fund" as const,
          available: filterWindow(series.series, range, anchorT).length >= 2,
        })) ?? [];
    return [...benchmarkItems, ...fundItems];
  }, [anchorT, benchmarkAvailability, benchmarkLabels, compareData?.fundSeries, data.fund.code, range]);
  const availableItemMap = useMemo(() => new Map(availableItems.map((item) => [item.key, item])), [availableItems]);
  const selectedRawKeys = useMemo(() => Object.entries(selected).filter(([, on]) => on).map(([key]) => key), [selected]);
  const activeKeys = useMemo(
    () =>
      selectedRawKeys
        .filter((key) => availableItemMap.get(key)?.available)
        .slice(0, 3),
    [availableItemMap, selectedRawKeys]
  );
  const selectedUnavailableLabels = useMemo(
    () =>
      selectedRawKeys
        .filter((key) => !availableItemMap.get(key)?.available)
        .map((key) => availableItemMap.get(key)?.label ?? key),
    [availableItemMap, selectedRawKeys]
  );
  const comparisonMode = activeKeys.length > 0;
  const activeLabels = useMemo(
    () => activeKeys.map((key) => availableItemMap.get(key)?.label ?? key),
    [activeKeys, availableItemMap]
  );

  const chartSeries = useMemo(() => {
    if (!comparisonMode) return [{ key: "fund", label: data.fund.code, points: chartWindow, color: "var(--accent-blue)" }];
    const fundBaseline = normalizeSeriesInRange(fundSeries, comparisonStartT, comparisonEndT);
    const keys = ["fund", ...activeKeys];
    const series = keys
      .map((key, index) => {
        const sourceSeries = key === "fund" ? fundSeries : (rawSeriesMap[key] ?? []);
        const points = key === "fund" ? fundBaseline : normalizeSeriesInRange(sourceSeries, comparisonStartT, comparisonEndT);
        if (!points || points.length < 2) return null;
        const palette = ["var(--accent-blue)", "#6d80a6", "#b58b61", "#7ca29a", "#b69a63", "#879387"];
        return {
          key,
          label: key === "fund" ? data.fund.code : (availableItemMap.get(key)?.label ?? key),
          points,
          color: palette[index] ?? palette[3],
        };
      })
      .filter(Boolean) as Array<{ key: string; label: string; points: Point[]; color: string }>;
    if (series.length > 0) return series;
    // Kıyas serileri hizalanamazsa boş grafik yerine fonun kendi çizgisini göster.
    return [{ key: "fund", label: data.fund.code, points: chartWindow, color: "var(--accent-blue)" }];
  }, [
    comparisonMode,
    data.fund.code,
    chartWindow,
    activeKeys,
    availableItemMap,
    comparisonEndT,
    comparisonStartT,
    fundSeries,
    rawSeriesMap,
  ]);

  const tMin = chartWindow[0]?.t ?? 0;
  const tMax = chartWindow[chartWindow.length - 1]?.t ?? 0;

  const xAxisTicks = useMemo(() => {
    if (chartWindow.length < 2) return [];
    const first = chartWindow[0]!.t;
    const last = chartWindow[chartWindow.length - 1]!.t;
    const mid = Math.round((first + last) / 2);
    const times = isNarrowViewport && comparisonMode ? [first, last] : [first, mid, last];
    return times.map((t) => {
      const x = PLOT_LEFT + ((t - first) / Math.max(1, last - first)) * INNER_W;
      return { t, x };
    });
  }, [chartWindow, comparisonMode, isNarrowViewport]);

  const periodReturnFund = useMemo(() => {
    if (fundWindow.length < 2) return null;
    const p0 = fundWindow[0]!.v;
    const p1 = fundWindow[fundWindow.length - 1]!.v;
    if (p0 <= 0) return null;
    return (p1 / p0 - 1) * 100;
  }, [fundWindow]);

  const handleChartPointerMove = (clientX: number) => {
    if (!chartSvgRef.current || comparisonMode || chartWindow.length === 0 || tMax <= tMin) return;
    const rect = chartSvgRef.current.getBoundingClientRect();
    const relativeX = ((clientX - rect.left) / Math.max(1, rect.width)) * VB_W;
    const clampedX = Math.min(PLOT_RIGHT, Math.max(PLOT_LEFT, relativeX));
    const ratio = (clampedX - PLOT_LEFT) / Math.max(1, INNER_W);
    const targetT = tMin + ratio * (tMax - tMin);
    let nearest = chartWindow[0]!;
    let bestDistance = Math.abs(nearest.t - targetT);
    for (let index = 1; index < chartWindow.length; index += 1) {
      const point = chartWindow[index]!;
      const distance = Math.abs(point.t - targetT);
      if (distance < bestDistance) {
        nearest = point;
        bestDistance = distance;
      }
    }
    setHoverState({
      x: clampedX,
      point: nearest,
    });
  };

  const clearChartHover = useCallback(() => {
    setHoverState(null);
  }, []);

  useEffect(() => {
    clearChartHover();
  }, [range, comparisonMode, anchorT, fundSeries.length, clearChartHover]);

  const comparisonPeriodId = useMemo(() => periodIdForRange(range), [range]);
  const comparisonPeriodLabel = useMemo(() => periodLabelForRange(range), [range]);
  const selectedBenchmarkRef = useMemo<KiyasRefKey | null>(() => {
    for (const key of activeKeys) {
      if ((BENCHMARK_REF_ORDER as string[]).includes(key)) {
        return key as KiyasRefKey;
      }
    }
    return null;
  }, [activeKeys]);

  const displayChartSeries = useMemo(() => {
    if (!comparisonMode || !isNarrowViewport) return chartSeries;
    const fund = chartSeries.find((s) => s.key === "fund");
    if (!fund) return chartSeries;
    const prefKey = selectedBenchmarkRef ?? activeKeys[0];
    const ref = prefKey ? chartSeries.find((s) => s.key === prefKey) : chartSeries.find((s) => s.key !== "fund");
    if (!ref) return chartSeries;
    return [fund, ref];
  }, [activeKeys, chartSeries, comparisonMode, isNarrowViewport, selectedBenchmarkRef]);

  const yDomain = useMemo(() => {
    const vals = displayChartSeries.flatMap((s) => s.points.map((p) => p.v));
    if (vals.length < 2) return null;
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }, [displayChartSeries]);

  const yLevels = useMemo(() => {
    if (!yDomain) return [];
    return yLevelsForScale(
      yDomain.min,
      yDomain.max,
      comparisonMode ? (n) => formatChartAxisPercentTick(n) : (n) => fmtChartAxisPrice(n)
    );
  }, [yDomain, comparisonMode]);

  const comparisonViewFromWindow = useMemo(
    () =>
      buildBenchmarkComparisonView({
        block: data.kiyasBlock,
        periodId: comparisonPeriodId,
        selectedRef: selectedBenchmarkRef,
        labels: compareData?.labels,
        preferredOrder: BENCHMARK_REF_ORDER,
        seriesWindow:
          fundWindow.length >= 2
            ? {
                fundSeries: fundWindow,
                startT: comparisonStartT,
                endT: comparisonEndT,
                refSeriesByKey: {
                  category: rawSeriesMap.category,
                  bist100: rawSeriesMap.bist100,
                  usdtry: rawSeriesMap.usdtry,
                  eurtry: rawSeriesMap.eurtry,
                  gold: rawSeriesMap.gold,
                  policy: rawSeriesMap.policy,
                },
              }
            : null,
      }),
    [
      compareData?.labels,
      comparisonEndT,
      comparisonPeriodId,
      comparisonStartT,
      data.kiyasBlock,
      fundWindow,
      rawSeriesMap,
      selectedBenchmarkRef,
    ]
  );

  /** Seri hizası düşük olduğunda pencere tabanlı satır üretimi boş kalabiliyor; kiyasBlock özet satırları yedek olarak kullanılır. */
  const comparisonViewFromBlock = useMemo(
    () =>
      data.kiyasBlock
        ? buildBenchmarkComparisonView({
            block: data.kiyasBlock,
            periodId: comparisonPeriodId,
            selectedRef: selectedBenchmarkRef,
            labels: compareData?.labels,
            preferredOrder: BENCHMARK_REF_ORDER,
          })
        : null,
    [compareData?.labels, comparisonPeriodId, data.kiyasBlock, selectedBenchmarkRef]
  );

  const comparisonView = useMemo(() => {
    // Pencere hesabı kıyaslanabilir satır ürettiğinde öncelik buradadır.
    // Tüm satırlar "veri yetersiz" ise blok fallback ile görünür özet korunur.
    const windowComparableCount = comparisonViewFromWindow.rows.filter(
      (row) => row.hasEnoughData && row.comparisonDeltaPct != null && Number.isFinite(row.comparisonDeltaPct)
    ).length;
    if (windowComparableCount > 0) return comparisonViewFromWindow;
    if (comparisonViewFromBlock && comparisonViewFromBlock.rows.length > 0) return comparisonViewFromBlock;
    return comparisonViewFromWindow;
  }, [comparisonViewFromBlock, comparisonViewFromWindow]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    // eslint-disable-next-line no-console -- yalnızca dev: kıyas payload doğrulaması
    console.debug("[fund-detail benchmark]", summarizeBenchmarkComparisonViewForDev(comparisonView));
  }, [comparisonView]);

  const comparisonRows = comparisonView.rows;
  const mainChartHasRenderablePayload = fundWindow.length >= 2;
  const shouldRenderMainChart =
    shouldRenderSectionFromContract(behavior.canRenderMainChart, mainChartHasRenderablePayload) &&
    mainChartHasRenderablePayload;
  const comparisonHasRenderablePayload = comparisonRows.length > 0;
  const shouldRenderComparisonSection = shouldRenderSectionFromContract(
    behavior.canRenderComparison,
    comparisonHasRenderablePayload
  );
  const comparableRows = useMemo(
    () => comparisonRows.filter((row) => row.hasEnoughData && row.comparisonDeltaPct != null && Number.isFinite(row.comparisonDeltaPct)),
    [comparisonRows]
  );
  const comparisonHasMeaningfulData = comparableRows.length > 0;
  const comparisonRowsPrimary = useMemo(() => comparisonRows.slice(0, 3), [comparisonRows]);
  const comparisonPrimary = comparisonView.primaryRow;
  const comparisonTableRows = useMemo(() => {
    if (comparisonExpanded) return comparisonRows;
    if (isNarrowViewport) {
      const fk = selectedBenchmarkRef ?? comparisonPrimary?.key;
      const hit = fk ? comparisonRows.find((r) => r.key === fk) : null;
      if (hit) return [hit];
      return comparisonRows.length > 0 ? [comparisonRows[0]!] : [];
    }
    return comparisonRowsPrimary;
  }, [
    comparisonExpanded,
    comparisonRows,
    comparisonRowsPrimary,
    comparisonPrimary,
    isNarrowViewport,
    selectedBenchmarkRef,
  ]);
  const comparisonExpandable = comparisonRows.length > (isNarrowViewport ? 1 : comparisonRowsPrimary.length);
  const showComparisonDetailTable = !isNarrowViewport || comparisonExpanded;
  const effectiveComparisonPrimary = comparisonHasMeaningfulData ? comparisonPrimary : null;
  const comparisonPrimaryDelta = effectiveComparisonPrimary?.comparisonDeltaPct ?? null;
  const passedReferenceCount = comparisonView.passedCount;
  const behindReferenceCount = comparisonView.behindCount;
  const tiedReferenceCount = comparisonView.tiedCount;
  const insufficientDataCount = comparisonView.insufficientDataCount;
  const comparisonBestOutperform = comparisonView.strongestOutperformRow;
  const comparisonBestUnderperform = comparisonView.strongestUnderperformRow;

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    compareDebugRenderCountRef.current += 1;
    console.info(
      `[fund-detail-comparison-visibility] code=${data.fund.code} render=${compareDebugRenderCountRef.current} ` +
        `canRenderComparison=${behavior.canRenderComparison ? 1 : 0} rows=${comparisonRows.length} ` +
        `meaningful=${comparisonHasMeaningfulData ? 1 : 0} shouldRenderSection=${shouldRenderComparisonSection ? 1 : 0} ` +
        `compareLoading=${compareLoading ? 1 : 0}`
    );
  }, [
    behavior.canRenderComparison,
    compareLoading,
    comparisonHasMeaningfulData,
    comparisonRows.length,
    data.fund.code,
    shouldRenderComparisonSection,
  ]);

  const comparisonDataIssuesTitle = useMemo(() => {
    const u = comparisonView.unavailableRefs.length;
    if (u === 0 && insufficientDataCount === 0) return null;
    const parts: string[] = [];
    if (u > 0) {
      parts.push(`${u} referans için bu dönemde tablo/kayıt verisi yok (liste dışı).`);
    }
    if (insufficientDataCount > 0) {
      parts.push(
        `${insufficientDataCount} referansta grafik penceresiyle hizalı seri ucu okunamadı; satırlarda “Veri yetersiz”.`
      );
    }
    return parts.join(" ");
  }, [comparisonView.unavailableRefs.length, insufficientDataCount]);

  return (
    <section aria-labelledby="fund-detail-chart-heading">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="min-w-0 flex-1">
          <FundDetailSectionTitle id="fund-detail-chart-heading">Performans</FundDetailSectionTitle>
        </div>
        <div
          className="flex shrink-0 gap-0.5 overflow-x-auto rounded-[11px] border p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] sm:gap-px"
          style={{
            borderColor: "color-mix(in srgb, var(--border-subtle) 92%, transparent)",
            background: "var(--surface-table-header)",
          }}
          role="tablist"
          aria-label="Zaman aralığı"
        >
          {RANGES.map((r) => {
            const active = range === r.id;
            return (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setRange(r.id)}
                className="min-h-[2rem] min-w-[2.2rem] shrink-0 rounded-[8px] px-2.5 text-[11px] font-semibold tracking-[-0.015em] transition-[color,background,border-color,box-shadow,opacity] hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent-blue)_28%,transparent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-table-header)] sm:px-3 sm:text-xs"
                style={{
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  background: active ? "var(--surface-control)" : "transparent",
                  boxShadow: active
                    ? "0 1px 2px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255,255,255,0.75)"
                    : "none",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: active ? "color-mix(in srgb, var(--segment-active-border) 85%, transparent)" : "transparent",
                }}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="mt-2 rounded-[1.05rem] border px-2.5 py-2.5 sm:mt-2.5 sm:px-4 sm:py-3.5"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--card-bg)",
          boxShadow: "var(--shadow-xs)",
        }}
      >
        {!shouldRenderMainChart ? (
          <p className="py-14 text-center text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {behavior.tier === "NO_USEFUL_DATA"
              ? behavior.noUsefulDataCopy
              : "Bu fon için yeterli fiyat geçmişi yok. Veri geldikçe grafik otomatik görünür."}
          </p>
        ) : (
          <>
            <div className="border-b pb-3 sm:pb-3.5" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(10.5rem,14.5rem)] sm:items-start sm:gap-5">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
                    Seçili dönem getirisi
                  </p>
                  <div className="mt-1.5 flex flex-col gap-0.5">
                    {periodReturnFund != null && Number.isFinite(periodReturnFund) ? (
                      <span
                        className="tabular-nums text-[1.32rem] font-semibold tracking-[-0.035em] sm:text-[1.66rem]"
                        style={{
                          color:
                            periodReturnFund > 0
                              ? "var(--success)"
                              : periodReturnFund < 0
                                ? "var(--danger)"
                                : "var(--text-secondary)",
                        }}
                      >
                        {formatDetailPeriodReturnPercent(periodReturnFund)}
                      </span>
                    ) : (
                      <span className="text-xl font-semibold" style={{ color: "var(--text-muted)" }}>
                        —
                      </span>
                    )}
                    <p
                      className="text-[11px] font-medium tabular-nums leading-snug sm:text-[11.5px]"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      {new Date(fundWindow[0]!.t).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })}
                      <span className="mx-1.5 opacity-35" aria-hidden>
                        ·
                      </span>
                      {new Date(fundWindow[fundWindow.length - 1]!.t).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  </div>
                </div>
                <p
                  className="max-w-none text-[11px] font-medium leading-snug sm:pt-0.5 sm:text-right sm:text-[11px]"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {comparisonMode
                    ? isNarrowViewport
                      ? "Normalize edilmiş getiri."
                      : "Normalize getiri; net fark tabloda."
                    : periodReturnFund != null
                      ? `${periodLabelForRange(range)} · ${periodReturnFund > 0 ? "pozitif" : periodReturnFund < 0 ? "negatif" : "yatay"} seyir`
                      : "Veri geldikçe özet burada görünür."}
                </p>
              </div>
              {selectedUnavailableLabels.length > 0 ? (
                <p className="mt-2 text-[10px] leading-snug sm:text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {selectedUnavailableLabels.join(", ")} seçili ama {comparisonPeriodLabel} döneminde veri bulunamadı.
                </p>
              ) : null}
              {behavior.hasLimitedCoverage && detailHistorySourceFromData(data) !== "history" ? (
                <p className="mt-2 text-[10px] leading-snug sm:text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {behavior.limitedCoverageCopy ?? "Grafik mevcut veri penceresiyle gösteriliyor."}
                </p>
              ) : null}
            </div>

            <div
              className="relative mt-2.5 w-full touch-none overflow-visible pb-0.5 sm:mt-3"
              style={{
                aspectRatio:
                  comparisonMode && isNarrowViewport ? `${VB_W} / 172` : comparisonMode ? `${VB_W} / 196` : `${VB_W} / 206`,
              }}
              onPointerLeave={clearChartHover}
              onPointerCancel={clearChartHover}
            >
              <svg
                ref={chartSvgRef}
                viewBox={`0 0 ${VB_W} ${VB_H}`}
                className="absolute inset-0 h-full w-full max-w-full select-none"
                preserveAspectRatio="none"
                role="img"
                aria-label={comparisonMode ? "Karşılaştırmalı dönem getirisi grafiği" : "Fon birim fiyatı grafiği"}
                onPointerMove={(event) => handleChartPointerMove(event.clientX)}
                onPointerLeave={clearChartHover}
              >
                <defs>
                  <linearGradient id={`perf-fund-fill-${fundAreaGradId}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.11" />
                    <stop offset="55%" stopColor="var(--accent-blue)" stopOpacity="0.03" />
                    <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0" />
                  </linearGradient>
                </defs>

                {yLevels.map((lvl, i) => (
                  <g key={i}>
                    <line
                      x1={PLOT_LEFT}
                      y1={lvl.y}
                      x2={PLOT_RIGHT - 1}
                      y2={lvl.y}
                      stroke="var(--border-subtle)"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      opacity={0.1}
                    />
                    <text
                      x={PLOT_LEFT - 9}
                      y={lvl.y}
                      textAnchor="end"
                      dominantBaseline="middle"
                      fill="var(--text-tertiary)"
                      fontSize={isNarrowViewport && comparisonMode ? 9 : 10}
                      fontWeight={500}
                      opacity={0.88}
                      className="tabular-nums"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {lvl.label}
                    </text>
                  </g>
                ))}

                {!comparisonMode && yDomain && chartSeries[0]?.key === "fund"
                  ? (() => {
                      const areaD = buildPerformanceAreaPath(chartSeries[0].points, tMin, tMax, yDomain.min, yDomain.max);
                      return areaD ? (
                        <path
                          key="fund-area"
                          d={areaD}
                          fill={`url(#perf-fund-fill-${fundAreaGradId})`}
                          stroke="none"
                        />
                      ) : null;
                    })()
                  : null}

                {displayChartSeries.map((s) => {
                  if (!yDomain) return null;
                  const d = buildPerformanceLinePath(s.points, tMin, tMax, yDomain.min, yDomain.max);
                  if (!d) return null;
                  return (
                    <path
                      key={s.key}
                      d={d}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={s.key === "fund" ? 1.45 : 1.12}
                      vectorEffect="non-scaling-stroke"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={s.key === "fund" ? 1 : 0.82}
                    />
                  );
                })}

                {!comparisonMode && !hoverState && yDomain && chartWindow.length >= 1 ? (
                  <g pointerEvents="none" opacity={0.92}>
                    {(() => {
                      const last = chartWindow[chartWindow.length - 1]!;
                      const cx = PLOT_LEFT + ((last.t - tMin) / Math.max(1, tMax - tMin)) * INNER_W;
                      const cy =
                        PLOT_TOP +
                        INNER_H -
                        ((last.v - yDomain.min) / Math.max(1e-9, yDomain.max - yDomain.min || 1)) * INNER_H;
                      return (
                        <>
                          <circle cx={cx} cy={cy} r={5.5} fill="var(--accent-blue)" fillOpacity={0.07} />
                          <circle
                            cx={cx}
                            cy={cy}
                            r={2.35}
                            fill="var(--card-bg)"
                            stroke="var(--accent-blue)"
                            strokeWidth={1.15}
                            strokeOpacity={0.72}
                          />
                        </>
                      );
                    })()}
                  </g>
                ) : null}

                {xAxisTicks.map((tick) => (
                  <text
                    key={tick.t}
                    x={tick.x}
                    y={X_LABEL_Y}
                    textAnchor="middle"
                    fill="var(--text-tertiary)"
                    fontSize={isNarrowViewport && comparisonMode ? 9 : 10}
                    fontWeight={500}
                    opacity={0.86}
                    className="tabular-nums"
                  >
                    {fmtAxisDateShort(tick.t)}
                  </text>
                ))}

                {!comparisonMode && hoverState && yDomain ? (
                  <>
                    <line
                      x1={hoverState.x}
                      y1={PLOT_TOP}
                      x2={hoverState.x}
                      y2={PLOT_BOTTOM}
                      stroke="var(--accent-blue)"
                      strokeOpacity="0.2"
                      strokeWidth={1}
                      strokeDasharray="3 5"
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={PLOT_LEFT + ((hoverState.point.t - tMin) / Math.max(1, tMax - tMin)) * INNER_W}
                      cy={PLOT_TOP + INNER_H - ((hoverState.point.v - yDomain.min) / Math.max(1e-9, yDomain.max - yDomain.min || 1)) * INNER_H}
                      r={2.85}
                      fill="var(--card-bg)"
                      stroke="var(--accent-blue)"
                      strokeWidth={1.35}
                      strokeOpacity={0.88}
                    />
                    <g
                      pointerEvents="none"
                      transform={`translate(${Math.min(
                        PLOT_RIGHT - 108,
                        Math.max(PLOT_LEFT + 4, hoverState.x - 54)
                      )},${PLOT_TOP + 5})`}
                    >
                      <rect
                        width={104}
                        height={36}
                        rx={8}
                        fill="var(--card-bg)"
                        stroke="color-mix(in srgb, var(--border-subtle) 75%, transparent)"
                        strokeWidth={1}
                        opacity={0.97}
                      />
                      <text x={52} y={15} textAnchor="middle" fill="var(--text-muted)" fontSize={9} fontWeight={600}>
                        {fmtAxisDateShort(hoverState.point.t)}
                      </text>
                      <text
                        x={52}
                        y={29}
                        textAnchor="middle"
                        fill="var(--text-primary)"
                        fontSize={11}
                        fontWeight={600}
                        className="tabular-nums"
                      >
                        {fmtChartAxisPrice(hoverState.point.v)}
                      </text>
                    </g>
                  </>
                ) : null}
              </svg>
            </div>

            <div
              className="mt-2.5 rounded-[11px] border px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.42)] sm:mt-3 sm:px-3 sm:py-2.5"
              style={{
                borderColor: "color-mix(in srgb, var(--border-subtle) 92%, transparent)",
                background: "color-mix(in srgb, var(--card-bg) 90%, var(--bg-muted))",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
                    Karşılaştırma
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
                    {activeLabels.length > 0 ? `${activeLabels.length} seçili · en fazla 3` : "Grafiğe en fazla 3 referans."}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleCurrentFundCompareToggle}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.75 text-[10.5px] font-medium transition-[background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent-blue)_30%,transparent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[color-mix(in_srgb,var(--card-bg)_94%,var(--bg-muted))]"
                    style={{
                      borderColor: fundOnCompare
                        ? "color-mix(in srgb, var(--accent-blue) 22%, var(--border-subtle))"
                        : "color-mix(in srgb, var(--border-subtle) 88%, transparent)",
                      color: fundOnCompare ? "var(--text-primary)" : "var(--text-secondary)",
                      background: fundOnCompare
                        ? "color-mix(in srgb, var(--accent-blue) 8%, var(--card-bg))"
                        : "color-mix(in srgb, var(--card-bg) 92%, var(--bg-muted))",
                      boxShadow: fundOnCompare ? "var(--shadow-xs)" : "none",
                    }}
                    aria-pressed={fundOnCompare}
                  >
                    {fundOnCompare ? <X className="h-3.5 w-3.5" strokeWidth={2} /> : <Plus className="h-3.5 w-3.5" strokeWidth={2} />}
                    {fundOnCompare ? "Karşılaştırmadan çıkar" : "Karşılaştırmaya ekle"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCompareControls((prev) => !prev)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.75 text-[10.5px] font-medium sm:hidden"
                    style={{
                      borderColor: "color-mix(in srgb, var(--border-subtle) 88%, transparent)",
                      color: "var(--text-secondary)",
                      background: "color-mix(in srgb, var(--card-bg) 92%, var(--bg-muted))",
                    }}
                    aria-expanded={showCompareControls || comparisonMode}
                  >
                    {comparisonMode ? "Düzenle" : "Aç"}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${(showCompareControls || comparisonMode) ? "rotate-180" : ""}`} strokeWidth={2} />
                  </button>
                </div>
              </div>

              {activeLabels.length > 0 ? (
                <div className="mt-1.5 flex max-md:-mx-0.5 max-md:gap-1 max-md:overflow-x-auto max-md:px-0.5 max-md:pb-0.5 max-md:flex-nowrap flex-wrap gap-1.25">
                  {activeLabels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex min-h-7 max-w-full items-center rounded-full border px-2.25 py-[0.28rem] text-[9.5px] font-medium"
                      style={{
                        borderColor: "color-mix(in srgb, var(--border-subtle) 88%, transparent)",
                        color: "var(--text-secondary)",
                        background: "color-mix(in srgb, var(--card-bg) 92%, var(--bg-muted))",
                      }}
                    >
                      <span className="truncate">{label}</span>
                    </span>
                  ))}
                </div>
              ) : null}

              <div className={`${showCompareControls || comparisonMode ? "mt-2" : "hidden sm:block sm:mt-2"}`}>
                <div className="flex flex-wrap items-center gap-1.25 sm:gap-1.5">
                  {availableItems.map((item) => {
                    const isOn = Boolean(selected[item.key]);
                    const canEnable = item.available || isOn;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={async () => {
                          if (!isOn && !compareData) {
                            await loadCompareData();
                          }
                          setSelected((prev) => {
                            const next = { ...prev };
                            const currentlyOn = Boolean(next[item.key]);
                            if (currentlyOn) {
                              delete next[item.key];
                              return next;
                            }
                            if (!item.available) return next;
                            const activeCount = Object.entries(next).filter(([key, on]) => on && availableItemMap.get(key)?.available).length;
                            if (activeCount >= 3) return next;
                            next[item.key] = true;
                            return next;
                          });
                        }}
                        disabled={compareLoading || !canEnable}
                        className="rounded-full border px-2.25 py-[4px] text-[9.5px] font-medium transition-[background-color,border-color,color,box-shadow] hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent-blue)_26%,transparent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[color-mix(in_srgb,var(--card-bg)_94%,var(--bg-muted))] sm:text-[10.5px]"
                        style={{
                          borderColor: isOn ? "var(--segment-active-border)" : "color-mix(in srgb, var(--border-subtle) 88%, transparent)",
                          color: isOn ? "var(--text-primary)" : (item.available ? "var(--text-secondary)" : "var(--text-tertiary)"),
                          background: isOn ? "color-mix(in srgb, var(--accent-blue) 6%, var(--card-bg))" : "color-mix(in srgb, var(--card-bg) 92%, var(--bg-muted))",
                          opacity: compareLoading || !item.available ? 0.55 : 1,
                        }}
                        title={!item.available ? `${comparisonPeriodLabel} için veri yok` : undefined}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div
        className="mt-2.5 rounded-xl border px-3 py-2.5 sm:mt-3 sm:px-3.5 sm:py-3"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--card-bg)",
          boxShadow: "var(--shadow-xs)",
        }}
      >
        <div className="border-b pb-2.5 sm:pb-3" style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 88%, transparent)" }}>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
              Getiri karşılaştırması
            </p>
            <h3
              id="fund-detail-return-comparison-heading"
              className="scroll-mt-24 mt-1 text-[14px] font-semibold tracking-[-0.02em] sm:scroll-mt-28 sm:text-[15px]"
              style={{ color: "var(--text-primary)" }}
            >
              <span className="md:hidden">Referansa göre sonuç</span>
              <span className="hidden md:inline">Seçili dönemde referanslara göre konum</span>
            </h3>
            <p className="mt-1.5 hidden text-[11px] leading-relaxed md:block md:text-[11.5px]" style={{ color: "var(--text-tertiary)" }}>
              Tablo: <span className="font-semibold" style={{ color: "var(--text-secondary)" }}>fon − referans</span> net farkı (pp). ±
              {BENCHMARK_COMPARISON_TIE_EPS_PP.toFixed(2).replace(".", ",")} pp başa baş.
            </p>
            <p className="mt-1.5 text-[10px] leading-snug md:hidden" style={{ color: "var(--text-tertiary)" }}>
              Net fark: fon getirisi eksi referans (yüzde puanı, pp).
            </p>
          </div>
        </div>
        {/* Renderable payload must win over coarse contract flags to avoid silent UI disappearance. */}
        {!shouldRenderComparisonSection ? (
          <div
            className="mt-2.5 rounded-[0.72rem] border px-3 py-2.5 text-[11px] leading-relaxed sm:mt-3 sm:px-3.5 sm:py-3 sm:text-[11.5px]"
            style={{
              borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
              background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
              color: "var(--text-secondary)",
            }}
          >
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
              {behavior.comparisonFallbackCopy}
            </p>
            <p className="mt-1 text-[10px] sm:text-[10.5px]" style={{ color: "var(--text-muted)" }}>
              Uygun referans oluştuğunda bu alan otomatik güncellenir.
            </p>
          </div>
        ) : comparisonRows.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            Seçili dönem için karşılaştırma verisi henüz yeterli değil.
          </p>
        ) : (
          <div className="mt-2.5 space-y-2 sm:mt-3 sm:space-y-2.5">
            {comparisonDataIssuesTitle ? (
              <p
                className="text-[10px] leading-snug sm:text-[10.5px]"
                style={{ color: "var(--text-muted)" }}
                title={comparisonDataIssuesTitle}
              >
                <span className="md:hidden">Veri / pencere uyarısı — ayrıntı için basılı tutun.</span>
                <span className="hidden md:inline">Bazı referanslarda veri veya pencere eksik — ayrıntı için üzerine gelin.</span>
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)] sm:items-stretch sm:gap-2.5" aria-label="Karşılaştırma özeti">
              <div
                className="flex min-h-0 flex-col justify-center rounded-[0.72rem] border px-3 py-2.5 shadow-[var(--shadow-xs)] sm:px-3.5 sm:py-2.5"
                style={{
                  borderColor: COMPARISON_VISUALS.fund!.border,
                  background: COMPARISON_VISUALS.fund!.surface,
                }}
              >
                <span className="text-[9px] font-semibold uppercase tracking-[0.11em]" style={{ color: "var(--text-muted)" }}>
                  <span className="md:hidden">Net fark (fon − ref.)</span>
                  <span className="hidden md:inline">Öncelikli net fark</span>
                </span>
                {effectiveComparisonPrimary ? (
                  <p className="mt-1 truncate text-[10px] font-semibold leading-snug md:hidden" style={{ color: "var(--text-secondary)" }}>
                    <span className="font-medium" style={{ color: "var(--text-muted)" }}>
                      {comparisonPeriodLabel} ·{" "}
                    </span>
                    {effectiveComparisonPrimary.label}
                  </p>
                ) : null}
                <span
                  className="mt-1 text-[1.42rem] font-semibold tabular-nums tracking-[-0.035em] max-md:text-[1.62rem] sm:text-[1.38rem]"
                  style={{ color: comparisonDeltaTone(comparisonPrimaryDelta) }}
                >
                  {comparisonPrimaryDelta != null ? formatDetailDeltaPercent(comparisonPrimaryDelta, DELTA_NEAR_EPS) : "—"}
                </span>
                {effectiveComparisonPrimary ? (
                  <span className="mt-1 line-clamp-2 hidden text-[10.5px] leading-snug sm:text-[11px] md:block" style={{ color: "var(--text-tertiary)" }}>
                    {primaryComparisonCaption(effectiveComparisonPrimary.label)}
                  </span>
                ) : null}
                {effectiveComparisonPrimary ? (
                  <span
                    className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-full border px-1.75 py-[0.15rem] text-[8.5px] font-medium sm:text-[9px]"
                    style={{
                      color:
                        effectiveComparisonPrimary.outcome === "insufficient_data"
                          ? "var(--text-tertiary)"
                          : comparisonDeltaTone(effectiveComparisonPrimary.comparisonDeltaPct),
                      borderColor: "color-mix(in srgb, currentColor 12%, var(--border-subtle))",
                      background:
                        effectiveComparisonPrimary.outcome === "insufficient_data"
                          ? "color-mix(in srgb, var(--text-tertiary) 8%, var(--card-bg))"
                          : effectiveComparisonPrimary.outcome === "outperform"
                            ? "color-mix(in srgb, var(--success-muted) 14%, var(--card-bg))"
                            : effectiveComparisonPrimary.outcome === "underperform"
                              ? "color-mix(in srgb, var(--danger-muted, #b91c1c) 11%, var(--card-bg))"
                              : "color-mix(in srgb, var(--text-tertiary) 8%, var(--card-bg))",
                    }}
                  >
                    {effectiveComparisonPrimary.outcome === "outperform" ? <Check className="h-2.75 w-2.75" strokeWidth={2.4} /> : null}
                    {comparisonOutcomeLabel(effectiveComparisonPrimary.outcome)}
                  </span>
                ) : null}
              </div>
              <div
                className="hidden flex-col justify-center rounded-[0.72rem] border px-3 py-2.5 text-[11px] sm:px-3.5 sm:py-2.5 sm:text-[11.5px] md:flex"
                style={{
                  borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
                  background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
                  color: "var(--text-secondary)",
                }}
              >
                <p className="text-[9px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
                  Özet
                </p>
                <p className="mt-1.5 font-medium tabular-nums leading-snug" style={{ color: "var(--text-primary)" }}>
                  {passedReferenceCount} geçti <span className="mx-1 opacity-35" aria-hidden>•</span>
                  {behindReferenceCount} geride <span className="mx-1 opacity-35" aria-hidden>•</span>
                  {tiedReferenceCount} başa baş
                </p>
                {insufficientDataCount > 0 ? (
                  <p className="mt-1 text-[10px] leading-snug" style={{ color: "var(--text-muted)" }}>
                    {insufficientDataCount} referansta veri yetersiz
                  </p>
                ) : null}
                <div className="mt-2 space-y-1.25 border-t pt-2" style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 68%, transparent)" }}>
                  {comparisonBestOutperform?.label &&
                  comparisonBestOutperform.hasEnoughData &&
                  comparisonBestOutperform.comparisonDeltaPct != null ? (
                    <p className="leading-snug" style={{ color: "var(--text-secondary)" }}>
                      <span style={{ color: "var(--text-muted)" }}>En güçlü: </span>
                      <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                        {comparisonBestOutperform.label}
                      </span>{" "}
                      <span className="tabular-nums font-semibold" style={{ color: "var(--success-muted)" }}>
                        {formatDetailDeltaPercent(comparisonBestOutperform.comparisonDeltaPct, DELTA_NEAR_EPS)}
                      </span>
                    </p>
                  ) : null}
                  {comparisonBestUnderperform?.label &&
                  comparisonBestUnderperform.hasEnoughData &&
                  comparisonBestUnderperform.comparisonDeltaPct != null &&
                  comparisonRows.length > 0 ? (
                    <p className="leading-snug" style={{ color: "var(--text-secondary)" }}>
                      <span style={{ color: "var(--text-muted)" }}>Zayıf kalan: </span>
                      <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                        {comparisonBestUnderperform.label}
                      </span>{" "}
                      <span className="tabular-nums font-semibold" style={{ color: "var(--danger-muted, #b91c1c)" }}>
                        {formatDetailDeltaPercent(comparisonBestUnderperform.comparisonDeltaPct, DELTA_NEAR_EPS)}
                      </span>
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
            <div
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[0.65rem] px-2.5 py-1.5 text-[10px] tabular-nums md:hidden"
              style={{
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
                background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
                color: "var(--text-secondary)",
              }}
            >
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {passedReferenceCount} geçti
              </span>
              <span className="opacity-35" aria-hidden>
                ·
              </span>
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {behindReferenceCount} geride
              </span>
              <span className="opacity-35" aria-hidden>
                ·
              </span>
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {tiedReferenceCount} başa baş
              </span>
              {insufficientDataCount > 0 ? (
                <span className="w-full text-[9.5px] font-medium" style={{ color: "var(--text-muted)" }}>
                  {insufficientDataCount} referansta veri yetersiz
                </span>
              ) : null}
            </div>
            {showComparisonDetailTable ? (
            <div className="overflow-hidden rounded-[0.72rem] border" style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)" }}>
              {comparisonTableRows.map((item, index) => {
                const visual = COMPARISON_VISUALS[item.key] ?? {
                  tone: "var(--text-secondary)",
                  surface: "color-mix(in srgb, var(--card-bg) 96%, white)",
                  border: "color-mix(in srgb, var(--border-subtle) 84%, transparent)",
                };
                const delta = item.comparisonDeltaPct;
                const outcome = comparisonOutcomeLabel(item.outcome);
                const hasDelta = item.hasEnoughData && delta != null;
                const rowTooltip = hasDelta
                  ? `Net fark (fon − referans): ${formatDetailDeltaPercent(delta, DELTA_NEAR_EPS)} · fon ${formatDetailAbsolutePercent(item.fundReturnPct)} · ref ${formatDetailAbsolutePercent(item.referenceReturnPct)}`
                  : "Bu pencerede referans serisi uçtan okunamadı.";
                const isStrongest =
                  Boolean(comparisonBestOutperform) && item.hasEnoughData && item.key === comparisonBestOutperform!.key;
                const isSelectedChart = selectedBenchmarkRef != null && item.key === selectedBenchmarkRef;
                const badgeBg =
                  outcome === "Geçti"
                    ? "color-mix(in srgb, var(--success-muted) 14%, var(--card-bg))"
                    : outcome === "Geride"
                      ? "color-mix(in srgb, var(--danger-muted, #b91c1c) 11%, var(--card-bg))"
                      : outcome === "Veri yetersiz"
                        ? "color-mix(in srgb, var(--text-tertiary) 10%, var(--card-bg))"
                        : "color-mix(in srgb, var(--text-tertiary) 8%, var(--card-bg))";
                return (
                  <div
                    key={item.key}
                    className={`group relative px-2.5 py-2 transition-[background-color,box-shadow] duration-150 sm:px-3 sm:py-2.5 ${
                      index === comparisonTableRows.length - 1 ? "" : "border-b"
                    }`}
                    style={{
                      borderColor: "color-mix(in srgb, var(--border-subtle) 78%, transparent)",
                      background:
                        isStrongest || isSelectedChart
                          ? "color-mix(in srgb, var(--accent-blue) 4.5%, var(--card-bg))"
                          : index % 2 === 0
                            ? "color-mix(in srgb, var(--card-bg) 99%, white)"
                            : "color-mix(in srgb, var(--bg-muted) 16%, var(--card-bg))",
                      boxShadow: isSelectedChart ? "inset 0 0 0 1px color-mix(in srgb, var(--accent-blue) 12%, transparent)" : undefined,
                    }}
                  >
                    <div
                      className="pointer-events-none absolute inset-y-2 left-0 w-px opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                      style={{ background: "color-mix(in srgb, var(--accent-blue) 45%, transparent)" }}
                      aria-hidden
                    />
                    <div className="relative flex min-w-0 items-center gap-2 sm:gap-2.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full sm:h-2 sm:w-2" style={{ background: visual.tone, opacity: 0.9 }} aria-hidden />
                      <span
                        className="min-w-0 flex-1 truncate text-[11.5px] font-semibold tracking-[-0.014em] sm:text-[12px]"
                        style={{ color: "var(--text-primary)" }}
                        title={rowTooltip}
                      >
                        {item.label}
                      </span>
                      <span
                        className="w-[4.35rem] shrink-0 text-right tabular-nums text-[11px] font-semibold tracking-[-0.018em] sm:w-[4.6rem] sm:text-[12px]"
                        style={{
                          color: hasDelta ? comparisonDeltaTone(delta) : "var(--text-tertiary)",
                        }}
                        title={rowTooltip}
                      >
                        {hasDelta ? formatDetailDeltaPercent(delta, DELTA_NEAR_EPS) : "—"}
                      </span>
                      <span
                        className="inline-flex h-[1.35rem] shrink-0 items-center justify-center gap-0.5 rounded-full border px-1.5 text-[8px] font-medium sm:h-6 sm:min-w-[4.5rem] sm:px-2 sm:text-[8.5px]"
                        style={{
                          color: outcome === "Veri yetersiz" ? "var(--text-tertiary)" : comparisonDeltaTone(delta),
                          borderColor: "color-mix(in srgb, currentColor 12%, var(--border-subtle))",
                          background: badgeBg,
                        }}
                        title={rowTooltip}
                      >
                        {outcome === "Geçti" ? <Check className="h-2.5 w-2.5 shrink-0" strokeWidth={2.4} /> : null}
                        {outcome}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            ) : null}
            {comparisonExpandable ? (
              <button
                type="button"
                onClick={() => setComparisonExpanded((prev) => !prev)}
                className="inline-flex items-center rounded-full border px-2.5 py-[0.34rem] text-[10px] font-medium transition-colors hover:text-[var(--text-primary)] sm:text-[11px]"
                style={{
                  borderColor: "color-mix(in srgb, var(--border-subtle) 86%, transparent)",
                  color: "var(--text-secondary)",
                  background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
                }}
                aria-expanded={comparisonExpanded}
              >
                {comparisonExpanded
                  ? "Daha az göster"
                  : isNarrowViewport
                    ? `Tüm referanslar (${comparisonRows.length})`
                    : "Tüm referansları gör"}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

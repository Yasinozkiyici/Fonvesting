"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import { formatFundLastPrice } from "@/lib/fund-list-format";
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
  buildBenchmarkComparisonView,
  type BenchmarkComparisonOutcome,
} from "@/lib/fund-detail-comparison";

const DAY_MS = 86400000;

const RANGES = [
  { id: "1m", label: "1A", days: 31 },
  { id: "3m", label: "3A", days: 93 },
  { id: "6m", label: "6A", days: 186 },
  { id: "1y", label: "1Y", days: 365 },
  { id: "2y", label: "2Y", days: 730 },
  { id: "all", label: "Tümü", days: null },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

const VB_W = 860;
const VB_H = 178;
const PAD_L = 54;
const PAD_R = 16;
const PAD_T = 5;
const PAD_B = 26;
const PLOT_LEFT = PAD_L;
const PLOT_RIGHT = VB_W - PAD_R;
const PLOT_TOP = PAD_T;
const PLOT_BOTTOM = VB_H - PAD_B;
const INNER_W = PLOT_RIGHT - PLOT_LEFT;
const INNER_H = PLOT_BOTTOM - PLOT_TOP;
const X_LABEL_Y = PLOT_BOTTOM + 12;
const DELTA_NEAR_EPS = 0.15;

type Point = { t: number; v: number };

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

function comparisonOutcomeLabel(outcome: BenchmarkComparisonOutcome): "Geçti" | "Geride" | "Başa baş" {
  if (outcome === "outperform") return "Geçti";
  if (outcome === "underperform") return "Geride";
  return "Başa baş";
}

function deltaBarMetrics(delta: number | null | undefined): { direction: "left" | "right"; widthPct: number } {
  const raw = Number.isFinite(delta) ? (delta as number) : 0;
  const direction = raw >= 0 ? "right" : "left";
  const magnitude = Math.abs(raw);
  const clamped = Math.min(magnitude, 35);
  const widthPct = magnitude <= DELTA_NEAR_EPS ? 0 : Math.max(11, (clamped / 35) * 56);
  return { direction, widthPct };
}

function periodIdForRange(range: RangeId): KiyasPeriodId {
  if (range === "1m" || range === "3m" || range === "6m" || range === "1y" || range === "2y") return range;
  return "3y";
}

function periodLabelForRange(range: RangeId): string {
  if (range === "1m") return "1 Ay";
  if (range === "3m") return "3 Ay";
  if (range === "6m") return "6 Ay";
  if (range === "1y") return "1 Yıl";
  if (range === "2y") return "2 Yıl";
  return "3 Yıl";
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value < 0 ? "-" : ""}%${Math.abs(value).toFixed(2).replace(".", ",")}`;
}

function formatDeltaPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > DELTA_NEAR_EPS ? "+" : value < -DELTA_NEAR_EPS ? "-" : "";
  return `${sign}%${Math.abs(value).toFixed(2).replace(".", ",")}`;
}

function comparisonDeltaTone(delta: number | null | undefined): string {
  if (delta == null || !Number.isFinite(delta)) return "var(--text-secondary)";
  if (Math.abs(delta) <= DELTA_NEAR_EPS) return "var(--text-secondary)";
  return delta > 0 ? "var(--success-muted)" : "var(--danger-muted, #b91c1c)";
}

function formatLongDate(t: number): string {
  return new Date(t).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
}

const FUND_COMPARISON_VISUAL = COMPARISON_VISUALS.fund!;

function filterWindow<T extends { t: number }>(series: T[], rangeId: RangeId, anchorT?: number): T[] {
  if (series.length === 0) return [];
  const cfg = RANGES.find((r) => r.id === rangeId);
  if (!cfg || cfg.days == null) return series;
  const lastT = anchorT ?? series[series.length - 1]!.t;
  const minT = lastT - cfg.days * DAY_MS;
  const win = series.filter((x) => x.t >= minT);
  return win.length >= 2 ? win : series;
}

function fmtChartAxisPrice(n: number): string {
  const s = formatFundLastPrice(n);
  return s === "—" ? s : `₺${s}`;
}

function fmtAxisDateShort(t: number): string {
  return new Date(t).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

function buildPath(points: Point[], tMin: number, tMax: number, min: number, max: number): string | null {
  if (points.length < 2) return null;
  const span = max - min || 1;
  const tSpan = tMax - tMin || 1;
  const d: string[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const x = PLOT_LEFT + ((points[i]!.t - tMin) / tSpan) * INNER_W;
    const y = PLOT_TOP + INNER_H - ((points[i]!.v - min) / span) * INNER_H;
    d.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return d.join(" ");
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
  const fundSeries = useMemo<Point[]>(
    () => data.priceSeries.map((x) => ({ t: x.t, v: x.p })),
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

  const loadCompareData = useCallback(async () => {
    if (compareRequestRef.current) {
      await compareRequestRef.current;
      return;
    }

    const codes = readCompareCodes().filter((c) => c !== data.fund.code).slice(0, 3);
    const qs = new URLSearchParams({
      base: data.fund.code,
      codes: codes.join(","),
    });

    setCompareLoading(true);
    compareAbortRef.current?.abort();
    const controller = new AbortController();
    compareAbortRef.current = controller;
    compareRequestRef.current = fetch(`/api/funds/compare-series?${qs.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return;
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
    const sync = async () => {
      const codes = readCompareCodes().filter((c) => c !== data.fund.code).slice(0, 3);
      if (codes.length === 0) {
        setCompareData(null);
        return;
      }
      await loadCompareData();
    };

    void sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === COMPARE_STORAGE_KEY) void sync();
    };
    const onCompareChange = () => {
      syncFundSelection();
      void sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(COMPARE_CODES_CHANGED_EVENT, onCompareChange);
    return () => {
      compareAbortRef.current?.abort();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(COMPARE_CODES_CHANGED_EVENT, onCompareChange);
    };
  }, [data.fund.code, loadCompareData]);

  const handleCurrentFundCompareToggle = () => {
    if (fundOnCompare) {
      removeCompareCode(data.fund.code);
      setFundOnCompare(false);
      return;
    }
    addCompareCode(data.fund.code);
    setFundOnCompare(true);
  };

  const availableItems = useMemo(() => {
    const base = [
      { key: "category", label: "Kategori Ortalaması" },
      { key: "bist100", label: "BIST 100" },
      { key: "usdtry", label: "USD/TRY" },
      { key: "eurtry", label: "EUR/TRY" },
      { key: "gold", label: "Altın" },
      { key: "policy", label: "Faiz / Para Piyasası Eşiği" },
    ];
    const funds =
      compareData?.fundSeries
        .filter((s) => s.code !== data.fund.code)
        .map((s) => ({ key: s.key, label: s.label })) ?? [];
    return [...base, ...funds];
  }, [compareData, data.fund.code]);

  const activeKeys = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([k]) => k).slice(0, 3),
    [selected]
  );
  const comparisonMode = activeKeys.length > 0;
  const activeLabels = useMemo(
    () => activeKeys.map((key) => availableItems.find((item) => item.key === key)?.label ?? key),
    [activeKeys, availableItems]
  );

  const rawSeriesMap = useMemo<Record<string, Point[]>>(() => {
    const map: Record<string, Point[]> = {
      fund: fundSeries,
      category: compareData?.macroSeries?.category ?? [],
      bist100: compareData?.macroSeries?.bist100 ?? [],
      usdtry: compareData?.macroSeries?.usdtry ?? [],
      eurtry: compareData?.macroSeries?.eurtry ?? [],
      gold: compareData?.macroSeries?.gold ?? [],
      policy: compareData?.macroSeries?.policy ?? [],
    };
    for (const f of compareData?.fundSeries ?? []) {
      map[f.key] = f.series;
    }
    return map;
  }, [compareData, fundSeries]);

  const anchorT = fundSeries[fundSeries.length - 1]?.t;
  const fundWindow = useMemo(() => filterWindow(fundSeries, range), [fundSeries, range]);
  const chartWindow = useMemo(() => filterWindow(fundSeries, range, anchorT), [fundSeries, range, anchorT]);

  const chartSeries = useMemo(() => {
    if (!comparisonMode) return [{ key: "fund", label: data.fund.code, points: chartWindow, color: "var(--accent-blue)" }];
    const keys = ["fund", ...activeKeys];
    return keys
      .map((key, index) => {
        const src = filterWindow(rawSeriesMap[key] ?? [], range, anchorT);
        if (src.length < 2) return null;
        const base = src[0]!.v;
        if (!Number.isFinite(base) || base <= 0) return null;
        const points = src.map((p) => ({ t: p.t, v: ((p.v / base) - 1) * 100 }));
        const palette = ["var(--accent-blue)", "#6d80a6", "#b58b61", "#7ca29a", "#b69a63", "#879387"];
        return { key, label: key === "fund" ? data.fund.code : (availableItems.find((i) => i.key === key)?.label ?? key), points, color: palette[index] ?? palette[3] };
      })
      .filter(Boolean) as Array<{ key: string; label: string; points: Point[]; color: string }>;
  }, [comparisonMode, activeKeys, rawSeriesMap, range, anchorT, data.fund.code, chartWindow, availableItems]);

  const yDomain = useMemo(() => {
    const vals = chartSeries.flatMap((s) => s.points.map((p) => p.v));
    if (vals.length < 2) return null;
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }, [chartSeries]);

  const tMin = chartWindow[0]?.t ?? 0;
  const tMax = chartWindow[chartWindow.length - 1]?.t ?? 0;

  const yLevels = useMemo(() => {
    if (!yDomain) return [];
    return yLevelsForScale(
      yDomain.min,
      yDomain.max,
      comparisonMode
        ? (n) => `${n.toFixed(1).replace(".", ",")}%`
        : (n) => fmtChartAxisPrice(n)
    );
  }, [yDomain, comparisonMode]);

  const xAxisTicks = useMemo(() => {
    if (chartWindow.length < 2) return [];
    const first = chartWindow[0]!.t;
    const last = chartWindow[chartWindow.length - 1]!.t;
    const mid = Math.round((first + last) / 2);
    return [first, mid, last].map((t) => {
      const x = PLOT_LEFT + ((t - first) / Math.max(1, last - first)) * INNER_W;
      return { t, x };
    });
  }, [chartWindow]);

  const periodReturnFund = useMemo(() => {
    if (fundWindow.length < 2) return null;
    const p0 = fundWindow[0]!.v;
    const p1 = fundWindow[fundWindow.length - 1]!.v;
    if (p0 <= 0) return null;
    return (p1 / p0 - 1) * 100;
  }, [fundWindow]);

  const hoverPriceLabel = useMemo(() => {
    if (comparisonMode || !hoverState) return null;
    return fmtChartAxisPrice(hoverState.point.v);
  }, [comparisonMode, hoverState]);

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

  const comparisonPeriodId = useMemo(() => periodIdForRange(range), [range]);
  const comparisonPeriodLabel = useMemo(() => periodLabelForRange(range), [range]);
  const comparisonView = useMemo(
    () =>
      buildBenchmarkComparisonView({
        block: data.kiyasBlock,
        periodId: comparisonPeriodId,
        labels: compareData?.labels,
        preferredOrder: ["category", "bist100", "usdtry", "eurtry", "gold", "policy"],
        nearEps: DELTA_NEAR_EPS,
      }),
    [compareData?.labels, comparisonPeriodId, data.kiyasBlock]
  );
  const comparisonRows = comparisonView.rows;
  const comparisonRowsPrimary = useMemo(() => {
    const preferred: KiyasRefKey[] = ["category", "bist100", "usdtry"];
    return preferred
      .map((key) => comparisonRows.find((item) => item.key === key) ?? null)
      .filter(Boolean) as typeof comparisonRows;
  }, [comparisonRows]);
  const comparisonRowsVisible = comparisonExpanded ? comparisonRows : comparisonRowsPrimary;
  const comparisonPrimary = comparisonView.primaryRow;
  const comparisonPrimaryDelta = comparisonPrimary?.difference ?? null;
  const passedReferenceCount = comparisonView.passedCount;
  const comparisonBestRelative = comparisonView.strongestRow;
  const comparisonHeadline = useMemo(() => {
    if (comparisonRows.length === 0) return null;
    const leadLabel = comparisonPrimary?.label ?? "ana referans";
    const leadDelta = comparisonPrimaryDelta;
    const leadText =
      leadDelta != null
        ? `${leadLabel} karşısında ${formatDeltaPercent(leadDelta)} ayrıştı`
        : `${leadLabel} karşısında kıyas verisi oluştu`;
    return `${comparisonPeriodLabel} görünümünde fon, ${leadText}; ${comparisonRows.length} referansın ${passedReferenceCount}'ini geçti.`;
  }, [comparisonPeriodLabel, comparisonPrimary?.label, comparisonPrimaryDelta, comparisonRows.length, passedReferenceCount]);
  return (
    <section aria-labelledby="fund-detail-chart-heading">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="min-w-0 flex-1">
          <FundDetailSectionTitle id="fund-detail-chart-heading">Performans</FundDetailSectionTitle>
        </div>
        <div
          className="flex shrink-0 gap-0.5 overflow-x-auto rounded-[10px] border p-0.5 sm:gap-px"
          style={{
            borderColor: "var(--border-subtle)",
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
                className="min-h-[2rem] min-w-[2.2rem] shrink-0 rounded-[8px] px-2.5 text-[11px] font-semibold tracking-[-0.015em] transition-[color,background,border-color,box-shadow,opacity] hover:opacity-95 sm:px-3 sm:text-xs"
                style={{
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  background: active ? "var(--surface-control)" : "transparent",
                  boxShadow: active ? "var(--shadow-xs)" : "none",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: active ? "var(--segment-active-border)" : "transparent",
                }}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="mt-2 rounded-[1.05rem] border px-3.5 py-3 sm:mt-2.5 sm:px-4 sm:py-3.5"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--card-bg)",
          boxShadow: "var(--shadow-xs)",
        }}
      >
        {fundWindow.length < 2 ? (
          <p className="py-14 text-center text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Bu fon için yeterli fiyat geçmişi yok. Veri geldikçe grafik otomatik görünür.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1 border-b pb-2.5 sm:pb-3" style={{ borderColor: "var(--border-subtle)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
                {hoverPriceLabel ? "Seçili fiyat" : "Seçili dönem getirisi"}
              </p>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                {hoverPriceLabel ? (
                  <span
                    className="tabular-nums text-[1.45rem] font-semibold tracking-[-0.03em] sm:text-[1.52rem]"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {hoverPriceLabel}
                  </span>
                ) : periodReturnFund != null && Number.isFinite(periodReturnFund) ? (
                  <span
                    className="tabular-nums text-[1.55rem] font-semibold tracking-[-0.03em] sm:text-[1.62rem]"
                    style={{
                      color:
                        periodReturnFund > 0
                          ? "var(--success)"
                          : periodReturnFund < 0
                            ? "var(--danger)"
                            : "var(--text-secondary)",
                    }}
                  >
                    {periodReturnFund > 0 ? "+" : ""}
                    {periodReturnFund.toFixed(2).replace(".", ",")}%
                  </span>
                ) : (
                  <span className="text-xl font-semibold" style={{ color: "var(--text-muted)" }}>
                    —
                  </span>
                )}
              </div>
              <p
                className="text-[11px] font-normal tabular-nums leading-snug sm:text-xs"
                style={{ color: "var(--text-tertiary)" }}
              >
                {hoverState && !comparisonMode ? (
                  formatLongDate(hoverState.point.t)
                ) : (
                  <>
                    {new Date(fundWindow[0]!.t).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })}
                    <span className="mx-1 opacity-40" aria-hidden>
                      ·
                    </span>
                    {new Date(fundWindow[fundWindow.length - 1]!.t).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })}
                  </>
                )}
              </p>
              <p className="text-[11px] leading-snug sm:text-xs" style={{ color: "var(--text-secondary)" }}>
                {comparisonMode
                  ? comparisonHeadline ?? "Seçili referanslarla normalize edilmiş dönem getirisi."
                  : periodReturnFund != null
                    ? `${periodLabelForRange(range)} aralığında ${periodReturnFund > 0 ? "pozitif" : periodReturnFund < 0 ? "negatif" : "yatay"} görünüm.`
                    : "Seçili aralıkta yeterli veri geldikçe görünüm burada özetlenir."}
              </p>
            </div>

            <div className="relative mt-3 w-full touch-none overflow-visible pb-1 sm:mt-3.5" style={{ aspectRatio: comparisonMode ? `${VB_W} / 194` : `${VB_W} / 204` }}>
              <svg
                ref={chartSvgRef}
                viewBox={`0 0 ${VB_W} ${VB_H}`}
                className="absolute inset-0 h-full w-full max-w-full select-none"
                preserveAspectRatio="none"
                role="img"
                aria-label={comparisonMode ? "Karşılaştırmalı dönem getirisi grafiği" : "Fon birim fiyatı grafiği"}
                onPointerMove={(event) => handleChartPointerMove(event.clientX)}
                onPointerLeave={() => setHoverState(null)}
              >
                {yLevels.map((lvl, i) => (
                  <g key={i}>
                        <line
                          x1={PLOT_LEFT}
                          y1={lvl.y}
                          x2={PLOT_RIGHT}
                          y2={lvl.y}
                          stroke="var(--border-subtle)"
                          strokeWidth={1}
                          vectorEffect="non-scaling-stroke"
                          opacity={0.28}
                        />
                        <text
                          x={PLOT_LEFT - 8}
                          y={lvl.y}
                          textAnchor="end"
                          dominantBaseline="middle"
                          fill="var(--text-tertiary)"
                          fontSize={9.5}
                          fontWeight={500}
                          opacity={0.72}
                          className="tabular-nums"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {lvl.label}
                        </text>
                  </g>
                ))}

                {chartSeries.map((s) => {
                  if (!yDomain) return null;
                  const d = buildPath(s.points, tMin, tMax, yDomain.min, yDomain.max);
                  if (!d) return null;
                  return (
                    <path
                      key={s.key}
                      d={d}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={s.key === "fund" ? 1.45 : 1.15}
                      vectorEffect="non-scaling-stroke"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={s.key === "fund" ? 0.95 : 0.82}
                    />
                  );
                })}

                {!comparisonMode && hoverState && yDomain ? (
                  <>
                    <line
                      x1={hoverState.x}
                      y1={PLOT_TOP}
                      x2={hoverState.x}
                      y2={PLOT_BOTTOM}
                      stroke="var(--accent-blue)"
                      strokeOpacity="0.28"
                      strokeWidth={1}
                      strokeDasharray="4 5"
                    />
                    <circle
                      cx={PLOT_LEFT + ((hoverState.point.t - tMin) / Math.max(1, tMax - tMin)) * INNER_W}
                      cy={PLOT_TOP + INNER_H - ((hoverState.point.v - yDomain.min) / Math.max(1e-9, yDomain.max - yDomain.min || 1)) * INNER_H}
                      r={4}
                      fill="var(--card-bg)"
                      stroke="var(--accent-blue)"
                      strokeWidth={2}
                    />
                  </>
                ) : null}

                {xAxisTicks.map((tick) => (
                  <text
                    key={tick.t}
                    x={tick.x}
                    y={X_LABEL_Y}
                    textAnchor="middle"
                    fill="var(--text-tertiary)"
                    fontSize={9.5}
                    fontWeight={500}
                    opacity={0.72}
                    className="tabular-nums"
                  >
                    {fmtAxisDateShort(tick.t)}
                  </text>
                ))}
              </svg>
            </div>

            <div
              className="mt-2.5 rounded-[0.95rem] border px-2.25 py-2.25 sm:mt-3 sm:px-2.75 sm:py-2.5"
              style={{
                borderColor: "color-mix(in srgb, var(--border-subtle) 85%, transparent)",
                background: "color-mix(in srgb, var(--card-bg) 94%, var(--bg-muted))",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-tertiary)" }}>
                    Karşılaştırma
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--text-secondary)" }}>
                    {activeLabels.length > 0
                      ? `${activeLabels.length} referans seçili`
                      : "Grafiğe en fazla 3 referans ekle."}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleCurrentFundCompareToggle}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.75 text-[10.5px] font-medium transition-[background-color,border-color,color]"
                    style={{
                      borderColor: fundOnCompare
                        ? "color-mix(in srgb, var(--accent-blue) 16%, var(--border-subtle))"
                        : "color-mix(in srgb, var(--border-subtle) 88%, transparent)",
                      color: fundOnCompare ? "var(--text-primary)" : "var(--text-secondary)",
                      background: fundOnCompare
                        ? "color-mix(in srgb, var(--accent-blue) 6%, var(--card-bg))"
                        : "color-mix(in srgb, var(--card-bg) 92%, var(--bg-muted))",
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
                <div className="mt-1.5 flex flex-wrap gap-1.25">
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
                            const activeCount = Object.values(next).filter(Boolean).length;
                            if (activeCount >= 3) return next;
                            next[item.key] = true;
                            return next;
                          });
                        }}
                        disabled={compareLoading}
                        className="rounded-full border px-2.25 py-[4px] text-[9.5px] font-medium transition-[background-color,border-color,color] hover:border-[var(--border-strong)] sm:text-[10.5px]"
                        style={{
                          borderColor: isOn ? "var(--segment-active-border)" : "color-mix(in srgb, var(--border-subtle) 88%, transparent)",
                          color: isOn ? "var(--text-primary)" : "var(--text-secondary)",
                          background: isOn ? "color-mix(in srgb, var(--accent-blue) 6%, var(--card-bg))" : "color-mix(in srgb, var(--card-bg) 92%, var(--bg-muted))",
                          opacity: compareLoading ? 0.72 : 1,
                        }}
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
        className="mt-2.5 rounded-[1.1rem] border px-3 py-3 sm:mt-3 sm:px-4 sm:py-4"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--card-bg)",
          boxShadow: "var(--shadow-xs)",
        }}
      >
        <div className="flex flex-col gap-1.25 border-b pb-3 sm:gap-1.5 sm:pb-3.5" style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 88%, transparent)" }}>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
              Getiri Karşılaştırması
            </p>
            <h3
              id="fund-detail-return-comparison-heading"
              className="mt-0.5 text-[15px] font-semibold tracking-[-0.02em] sm:text-[16px]"
              style={{ color: "var(--text-primary)" }}
            >
              Referanslara karşı görünüm
            </h3>
            {comparisonHeadline ? (
              <p className="mt-1 text-[12px] leading-snug sm:text-[13px]" style={{ color: "var(--text-primary)" }}>
                {comparisonHeadline}
              </p>
            ) : null}
            {comparisonBestRelative?.label ? (
              <p className="text-[10px] leading-snug sm:text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                En güçlü ayrışma {comparisonBestRelative.label} karşısında gerçekleşti.
              </p>
            ) : null}
          </div>
        </div>
        {comparisonRows.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            Seçili dönem için karşılaştırma verisi henüz yeterli değil.
          </p>
        ) : (
          <div className="mt-3 space-y-2.5 sm:mt-3.5 sm:space-y-3">
            {comparisonView.unavailableRefs.length > 0 ? (
              <p className="text-[10px] leading-snug sm:text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                {comparisonView.unavailableRefs.length} referans için {comparisonPeriodLabel} döneminde veri yok.
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Karşılaştırma özeti">
              <div
                className="flex min-h-[4.25rem] flex-col justify-center rounded-[0.95rem] border px-3 py-2.5"
                style={{
                  borderColor: FUND_COMPARISON_VISUAL.border,
                  background: FUND_COMPARISON_VISUAL.surface,
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22)",
                }}
              >
                <span className="text-[10px] font-medium uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>Referansa göre fark</span>
                <span className="mt-1 text-[16px] font-semibold tabular-nums tracking-[-0.025em]" style={{ color: "var(--text-primary)" }}>
                  {comparisonPrimaryDelta != null ? formatDeltaPercent(comparisonPrimaryDelta) : "—"}
                </span>
                {comparisonPrimary ? (
                  <span className="mt-1 text-[10.5px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
                    {comparisonPrimary.label}: fon {formatPercent(comparisonPrimary.fundReturn)} / referans {formatPercent(comparisonPrimary.benchmarkReturn)}
                  </span>
                ) : null}
              </div>
              <div
                className="flex min-h-[4.25rem] flex-col justify-center rounded-[0.95rem] border px-3 py-2.5"
                style={{
                  borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
                  background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
                }}
              >
                <span className="text-[10px] font-medium uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>Geçilen referans</span>
                <span className="mt-1 text-[16px] font-semibold tabular-nums tracking-[-0.025em]" style={{ color: "var(--text-primary)" }}>
                  {passedReferenceCount}/{comparisonRows.length}
                </span>
              </div>
              <div
                className="flex min-h-[4.25rem] flex-col justify-center rounded-[0.95rem] border px-3 py-2.5 sm:col-span-2 xl:col-span-1"
                style={{
                  borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
                  background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
                }}
              >
                <span className="text-[10px] font-medium uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>En güçlü ayrışma</span>
                <span className="mt-1 max-w-[20rem] text-[13px] font-semibold tracking-[-0.02em] sm:text-[14px]" style={{ color: "var(--text-primary)" }}>
                  {comparisonBestRelative?.label ?? "—"}
                </span>
                {comparisonBestRelative ? (
                  <span className="mt-1 text-[10.5px] leading-snug" style={{ color: comparisonDeltaTone(comparisonBestRelative.difference) }}>
                    {formatDeltaPercent(comparisonBestRelative.difference)}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="overflow-hidden rounded-[1rem] border" style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)" }}>
              {comparisonRowsVisible.map((item, index) => {
                const visual = COMPARISON_VISUALS[item.key] ?? {
                  tone: "var(--text-secondary)",
                  surface: "color-mix(in srgb, var(--card-bg) 96%, white)",
                  border: "color-mix(in srgb, var(--border-subtle) 84%, transparent)",
                };
                const delta = item.difference;
                const outcome = comparisonOutcomeLabel(item.outcome);
                const deltaBar = deltaBarMetrics(delta);
                const badgeBg =
                  outcome === "Geçti"
                    ? "color-mix(in srgb, var(--success-muted) 14%, var(--card-bg))"
                    : outcome === "Geride"
                      ? "color-mix(in srgb, var(--danger-muted, #b91c1c) 11%, var(--card-bg))"
                      : "color-mix(in srgb, var(--text-tertiary) 8%, var(--card-bg))";
                return (
                  <div
                    key={item.key}
                    className={`px-3 py-3 sm:px-4 sm:py-3.5 ${index === comparisonRowsVisible.length - 1 ? "" : "border-b"}`}
                    style={{
                      borderColor: "color-mix(in srgb, var(--border-subtle) 78%, transparent)",
                      background: index % 2 === 0 ? "color-mix(in srgb, var(--card-bg) 99%, white)" : "color-mix(in srgb, var(--bg-muted) 20%, var(--card-bg))",
                    }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-3 md:hidden">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="mt-1 h-2 w-2 shrink-0 rounded-full"
                              style={{ background: visual.tone, opacity: 0.92 }}
                              aria-hidden
                            />
                            <span className="truncate text-[12.5px] font-semibold tracking-[-0.015em]" style={{ color: "var(--text-primary)" }}>
                              {item.label}
                            </span>
                            {item.key !== "category" ? (
                              <span
                                className="shrink-0 rounded-full border px-1.5 py-[2px] text-[8px] font-medium"
                                style={{
                                  borderColor: visual.border,
                                  background: "color-mix(in srgb, var(--card-bg) 97%, var(--bg-muted))",
                                  color: "var(--text-tertiary)",
                                }}
                              >
                                {item.typeLabel}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-[10px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
                            Fon {formatPercent(item.fundReturn)} • Referans {formatPercent(item.benchmarkReturn)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span
                            className="block tabular-nums text-[12px] font-semibold tracking-[-0.02em]"
                            style={{ color: comparisonDeltaTone(delta) }}
                            title={`Referans getirisi: ${formatPercent(item.benchmarkReturn)}`}
                          >
                            {formatDeltaPercent(delta)}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2 md:hidden">
                        <div
                          className="relative h-[6px] min-w-0 flex-1 overflow-hidden rounded-full"
                          style={{
                            background: "color-mix(in srgb, var(--bg-muted) 76%, var(--card-bg))",
                            border: "1px solid color-mix(in srgb, var(--border-subtle) 76%, transparent)",
                            boxSizing: "border-box",
                          }}
                          aria-hidden
                        >
                          <span
                            className="absolute left-1/2 top-1/2 h-[10px] w-px -translate-x-1/2 -translate-y-1/2 rounded-full"
                            style={{ background: "color-mix(in srgb, var(--text-tertiary) 52%, transparent)" }}
                          />
                          {deltaBar.widthPct > 0 ? (
                            <span
                              className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-full"
                              style={{
                                left: deltaBar.direction === "right" ? "50%" : undefined,
                                right: deltaBar.direction === "left" ? "50%" : undefined,
                                width: `${deltaBar.widthPct}%`,
                                marginLeft: deltaBar.direction === "right" ? "3px" : undefined,
                                marginRight: deltaBar.direction === "left" ? "3px" : undefined,
                                background:
                                  outcome === "Geçti"
                                    ? "color-mix(in srgb, var(--success-muted) 76%, var(--card-bg))"
                                    : outcome === "Geride"
                                      ? "color-mix(in srgb, var(--danger-muted) 74%, var(--card-bg))"
                                      : "color-mix(in srgb, var(--text-tertiary) 52%, var(--card-bg))",
                              }}
                            />
                          ) : null}
                        </div>
                        <span
                          className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[8px] font-medium"
                          style={{
                            color: comparisonDeltaTone(delta),
                            borderColor: "color-mix(in srgb, currentColor 14%, var(--border-subtle))",
                            background: badgeBg,
                          }}
                        >
                          {outcome === "Geçti" ? <Check className="h-2.75 w-2.75" strokeWidth={2.4} /> : null}
                          <span>{outcome}</span>
                        </span>
                      </div>

                      <div className="hidden min-w-0 md:grid md:grid-cols-[minmax(180px,240px)_minmax(220px,1fr)_100px_72px] md:items-center md:gap-4">
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ background: visual.tone, opacity: 0.92 }}
                              aria-hidden
                            />
                            <span className="truncate text-[12.5px] font-semibold tracking-[-0.015em]" style={{ color: "var(--text-primary)" }}>
                              {item.label}
                            </span>
                            {item.key !== "category" ? (
                              <span
                                className="shrink-0 rounded-full border px-1.5 py-[2px] text-[8px] font-medium"
                                style={{
                                  borderColor: visual.border,
                                  background: "color-mix(in srgb, var(--card-bg) 97%, var(--bg-muted))",
                                  color: "var(--text-tertiary)",
                                }}
                              >
                                {item.typeLabel}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-[10px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
                            Fon {formatPercent(item.fundReturn)} • Referans {formatPercent(item.benchmarkReturn)}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <div
                            className="relative h-[6px] w-full overflow-hidden rounded-full"
                            style={{
                              background: "color-mix(in srgb, var(--bg-muted) 76%, var(--card-bg))",
                              border: "1px solid color-mix(in srgb, var(--border-subtle) 76%, transparent)",
                              boxSizing: "border-box",
                            }}
                            aria-hidden
                          >
                            <span
                              className="absolute left-1/2 top-1/2 h-[10px] w-px -translate-x-1/2 -translate-y-1/2 rounded-full"
                              style={{ background: "color-mix(in srgb, var(--text-tertiary) 52%, transparent)" }}
                            />
                            {deltaBar.widthPct > 0 ? (
                              <span
                                className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-full"
                                style={{
                                  left: deltaBar.direction === "right" ? "50%" : undefined,
                                  right: deltaBar.direction === "left" ? "50%" : undefined,
                                  width: `${deltaBar.widthPct}%`,
                                  marginLeft: deltaBar.direction === "right" ? "3px" : undefined,
                                  marginRight: deltaBar.direction === "left" ? "3px" : undefined,
                                  background:
                                    outcome === "Geçti"
                                      ? "color-mix(in srgb, var(--success-muted) 76%, var(--card-bg))"
                                      : outcome === "Geride"
                                        ? "color-mix(in srgb, var(--danger-muted) 74%, var(--card-bg))"
                                        : "color-mix(in srgb, var(--text-tertiary) 52%, var(--card-bg))",
                                }}
                              />
                            ) : null}
                          </div>
                        </div>
                        <div className="min-w-0 text-right">
                          <span
                            className="tabular-nums text-[12px] font-semibold tracking-[-0.02em]"
                            style={{ color: comparisonDeltaTone(delta) }}
                            title={`Referans getirisi: ${formatPercent(item.benchmarkReturn)}`}
                          >
                            {formatDeltaPercent(delta)}
                          </span>
                        </div>
                        <span
                          className="inline-flex h-6 items-center justify-center rounded-full border px-2 text-[8.5px] font-medium"
                          style={{
                            color: comparisonDeltaTone(delta),
                            borderColor: "color-mix(in srgb, currentColor 14%, var(--border-subtle))",
                            background: badgeBg,
                          }}
                        >
                          {outcome === "Geçti" ? <Check className="mr-1 h-3 w-3" strokeWidth={2.4} /> : null}
                          {outcome}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {comparisonRows.length > comparisonRowsPrimary.length ? (
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
                {comparisonExpanded ? "Daha az göster" : "Tüm referansları gör"}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

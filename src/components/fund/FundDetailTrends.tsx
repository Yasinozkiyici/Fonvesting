"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { MobileDetailAccordion } from "@/components/fund/MobileDetailAccordion";
import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import {
  buildLinearClosedAreaPathD,
  buildLinearPathD,
  buildMonotoneClosedAreaPathD,
  buildMonotoneXPathD,
  dedupeChartPointsByX,
  type ChartPathPoint,
} from "@/lib/chart-monotone-path";
import { formatDetailTrendWindowDeltaPercent, formatTrendCardNumeric } from "@/lib/fund-detail-format";
import { deriveFundDetailBehaviorContract, shouldRenderSectionFromContract } from "@/lib/fund-detail-section-status";
import type { FundDetailPageData, FundDetailTrendPoint } from "@/lib/services/fund-detail.service";

type Props = { data: FundDetailPageData };
const DAY_MS = 86400000;
const TREND_SVG_WIDTH = 320;
const TREND_SVG_HEIGHT = 128;
const TREND_PLOT_LEFT = 2;
const TREND_DEFAULT_RIGHT_GUTTER = 44;
const TREND_WIDE_RIGHT_GUTTER = 56;
const RANGE_OPTIONS = [
  { id: "1m", label: "1A", days: 31 },
  { id: "3m", label: "3A", days: 93 },
  { id: "6m", label: "6A", days: 186 },
  { id: "1y", label: "1Y", days: 365 },
  { id: "3y", label: "3Y", days: null },
] as const;
type TrendRangeId = (typeof RANGE_OPTIONS)[number]["id"];
type TrendKind = "currency" | "count";
type TrendRenderPoint = FundDetailTrendPoint & { gapBefore?: boolean };
type TrendSanitizeStats = {
  rawCount: number;
  cleanedCount: number;
  duplicateTimestampRemoved: number;
  invalidRemoved: number;
  outOfDomainRemoved: number;
  minT: number | null;
  maxT: number | null;
  hasDuplicateXAfterSanitize: boolean;
  hasInvalidYAfterSanitize: boolean;
};
const DEBUG_TREND_CODES = new Set(
  (process.env.NEXT_PUBLIC_FUND_TREND_DEBUG_CODES || "VGA,KAN,BNA,TI2")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
);

function formatTrendDate(timestamp: number): string {
  return new Intl.DateTimeFormat("tr-TR", { month: "short", year: "2-digit" }).format(new Date(timestamp));
}

function formatTrendTooltipDate(timestamp: number): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(timestamp));
}

function normalizeTrendPoints(
  points: FundDetailTrendPoint[],
  kind: TrendKind
): { points: FundDetailTrendPoint[]; stats: TrendSanitizeStats } {
  if (points.length === 0) {
    return {
      points: [],
      stats: {
        rawCount: 0,
        cleanedCount: 0,
        duplicateTimestampRemoved: 0,
        invalidRemoved: 0,
        outOfDomainRemoved: 0,
        minT: null,
        maxT: null,
        hasDuplicateXAfterSanitize: false,
        hasInvalidYAfterSanitize: false,
      },
    };
  }
  let invalidRemoved = 0;
  let outOfDomainRemoved = 0;
  const sorted = [...points]
    .filter((point) => {
      const valid = Number.isFinite(point.t) && Number.isFinite(point.v);
      if (!valid) invalidRemoved += 1;
      return valid;
    })
    .sort((a, b) => a.t - b.t);

  const byTimestamp = new Map<number, number>();
  for (const point of sorted) {
    if (kind === "currency" && point.v <= 0) {
      outOfDomainRemoved += 1;
      continue;
    }
    if (kind === "count" && point.v < 0) {
      outOfDomainRemoved += 1;
      continue;
    }
    byTimestamp.set(point.t, point.v);
  }
  const normalized = [...byTimestamp.entries()].map(([t, v]) => ({ t, v }));
  const duplicateTimestampRemoved = Math.max(0, sorted.length - normalized.length);
  const ts = normalized.map((item) => item.t);
  const uniqueTs = new Set(ts).size;
  const hasInvalidYAfterSanitize = normalized.some((item) => !Number.isFinite(item.v) || (kind === "currency" ? item.v <= 0 : item.v < 0));
  return {
    points: normalized,
    stats: {
      rawCount: points.length,
      cleanedCount: normalized.length,
      duplicateTimestampRemoved,
      invalidRemoved,
      outOfDomainRemoved,
      minT: ts.length > 0 ? ts[0]! : null,
      maxT: ts.length > 0 ? ts[ts.length - 1]! : null,
      hasDuplicateXAfterSanitize: uniqueTs !== ts.length,
      hasInvalidYAfterSanitize,
    },
  };
}

function filterTrendPoints(points: FundDetailTrendPoint[], range: TrendRangeId): FundDetailTrendPoint[] {
  if (points.length === 0) return points;
  const selected = RANGE_OPTIONS.find((option) => option.id === range);
  if (!selected || selected.days == null) return points;
  const maxTime = points[points.length - 1]!.t;
  const minTime = maxTime - selected.days * DAY_MS;
  const sliced = points.filter((point) => point.t >= minTime);
  return sliced.length >= 2 ? sliced : points;
}

function hasRenderableTrendPayload(points: FundDetailTrendPoint[], kind: TrendKind): boolean {
  const cleaned = points.filter(
    (point) =>
      Number.isFinite(point.t) &&
      Number.isFinite(point.v) &&
      (kind === "currency" ? point.v > 0 : point.v >= 0)
  );
  return cleaned.length >= 2;
}

function addGapMarkers(points: FundDetailTrendPoint[]): TrendRenderPoint[] {
  // Premium continuity: trend çizgisini mümkün olduğunca tek path olarak tut.
  // Büyük tarih boşlukları satırı parçalayıp "kırık/fragmented" hissi üretiyordu.
  return points;
}

/** Grafik ve % için güvenilir başlangıç: para ≤0 veya yatırımcı <1 başlangıçları atlanır (0 baseline hatası). */
function trimLeadingInvalidTrendBaseline(points: FundDetailTrendPoint[], kind: TrendKind): FundDetailTrendPoint[] {
  let i = 0;
  while (i < points.length) {
    const v = points[i]!.v;
    if (!Number.isFinite(v)) {
      i += 1;
      continue;
    }
    if (kind === "currency" && v <= 0) {
      i += 1;
      continue;
    }
    if (kind === "count" && v < 1) {
      i += 1;
      continue;
    }
    break;
  }
  return i > 0 ? points.slice(i) : points;
}

function ensureRenderableTrendSeries(points: FundDetailTrendPoint[]): FundDetailTrendPoint[] {
  // Tek veri noktasında sentetik nokta eklemek, görselde yanıltıcı dikey artefaktlara yol açabiliyor.
  return points;
}

type TrendCurveMode = "linear" | "monotone";
type TrendDebugRenderMode = "prod" | "line-only" | "area-only" | "flat-fill" | "synthetic-pad";

function parseTrendRenderMode(raw: string | null): TrendDebugRenderMode {
  if (raw === "line-only" || raw === "area-only" || raw === "flat-fill" || raw === "synthetic-pad") return raw;
  return "prod";
}

function parseTrendCurveMode(raw: string | null): TrendCurveMode | null {
  if (raw === "linear" || raw === "monotone") return raw;
  return null;
}

function parseTruthyFlag(raw: string | null): boolean {
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
}

function shouldPreferLinearOnTail(points: FundDetailTrendPoint[]): boolean {
  if (points.length < 6) return false;
  const tail = points.slice(-6);
  const deltas: number[] = [];
  for (let i = 1; i < tail.length; i += 1) {
    deltas.push(tail[i]!.v - tail[i - 1]!.v);
  }
  const abs = deltas.map((value) => Math.abs(value)).filter((value) => value > 0);
  if (abs.length < 3) return false;
  const sorted = abs.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (median <= 0) return false;
  let signFlips = 0;
  for (let i = 1; i < deltas.length; i += 1) {
    const prev = deltas[i - 1]!;
    const next = deltas[i]!;
    if (Math.sign(prev) !== 0 && Math.sign(next) !== 0 && Math.sign(prev) !== Math.sign(next)) {
      signFlips += 1;
    }
  }
  const lastDelta = Math.abs(deltas[deltas.length - 1] ?? 0);
  return signFlips >= 2 || lastDelta / median >= 3.8;
}

function applySyntheticPaddingForDebug(points: FundDetailTrendPoint[]): FundDetailTrendPoint[] {
  if (points.length === 0) return points;
  if (points.length === 1) {
    const only = points[0]!;
    return [
      { t: only.t - DAY_MS, v: only.v },
      only,
      { t: only.t + DAY_MS, v: only.v },
    ];
  }
  if (points.length === 2) {
    const [first, last] = points;
    const midT = Math.round((first!.t + last!.t) / 2);
    const midV = (first!.v + last!.v) / 2;
    return [first!, { t: midT, v: midV }, last!];
  }
  return points;
}

function buildChart(
  points: TrendRenderPoint[],
  width: number,
  height: number,
  curve: TrendCurveMode
): {
  lines: string[];
  areas: string[];
  yMin: number;
  yMax: number;
  values: number[];
} | null {
  if (points.length < 2) return null;
  const values = points.map((point) => point.v).filter((value) => Number.isFinite(value));
  if (values.length < 2) return null;

  const topPad = 10;
  const bottomPad = 12;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(1, Math.abs(max) * 0.02);
  const tMin = points[0]!.t;
  const tMax = points[points.length - 1]!.t;
  const tSpan = Math.max(1, tMax - tMin);
  const yMin = min - span * 0.06;
  const yMax = max + span * 0.06;
  const ySpan = yMax - yMin || 1;

  const toY = (value: number) => topPad + (1 - (value - yMin) / ySpan) * (height - topPad - bottomPad);
  const toXY = (t: number, v: number): ChartPathPoint => ({
    x: ((t - tMin) / tSpan) * width,
    y: toY(v),
  });

  const bottomY = height - bottomPad;
  const segments: FundDetailTrendPoint[][] = [];
  let seg: FundDetailTrendPoint[] = [];
  for (const point of points) {
    if (point.gapBefore && seg.length >= 2) {
      segments.push(seg);
      seg = [];
    }
    seg.push({ t: point.t, v: point.v });
  }
  if (seg.length >= 2) segments.push(seg);

  const lines: string[] = [];
  const areas: string[] = [];
  for (const s of segments) {
    const xy = dedupeChartPointsByX(s.map((p) => toXY(p.t, p.v)));
    let lineD =
      curve === "monotone" ? buildMonotoneXPathD(xy) : buildLinearPathD(xy);
    if (!lineD && curve === "monotone") lineD = buildLinearPathD(xy);
    if (!lineD) continue;
    lines.push(lineD);
    let areaD =
      curve === "monotone"
        ? buildMonotoneClosedAreaPathD(xy, bottomY)
        : buildLinearClosedAreaPathD(xy, bottomY);
    if (!areaD && curve === "monotone") areaD = buildLinearClosedAreaPathD(xy, bottomY);
    if (areaD) areas.push(areaD);
  }

  if (lines.length === 0) return null;
  return { lines, areas, yMin, yMax, values };
}

function RangeSwitcher({
  range,
  onChange,
  ariaLabel,
}: {
  range: TrendRangeId;
  onChange: (next: TrendRangeId) => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="inline-flex flex-wrap items-center gap-0.5 rounded-[10px] border p-0.5"
      style={{ borderColor: "var(--border-subtle)", background: "var(--surface-table-header)" }}
      role="tablist"
      aria-label={ariaLabel}
    >
      {RANGE_OPTIONS.map((option) => {
        const active = option.id === range;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.id)}
            className="min-h-[1.75rem] min-w-[1.95rem] rounded-[8px] px-2.5 text-[10px] font-semibold tracking-[-0.015em] transition-[color,background,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent-blue)_26%,transparent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-table-header)] sm:text-[11px]"
            style={{
              color: active ? "var(--text-primary)" : "var(--text-muted)",
              background: active ? "var(--surface-control)" : "transparent",
              boxShadow: active ? "var(--shadow-xs)" : "none",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: active ? "var(--segment-active-border)" : "transparent",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function TrendMetricCard({
  fundCode,
  eyebrow,
  title,
  currentValue,
  points,
  kind,
  range,
  onRangeChange,
}: {
  fundCode: string;
  eyebrow: string;
  title: string;
  currentValue: number;
  points: FundDetailTrendPoint[];
  kind: TrendKind;
  range: TrendRangeId;
  onRangeChange: (next: TrendRangeId) => void;
}) {
  const reactId = useId().replace(/:/g, "");
  const chartId = `${reactId}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [debugRenderMode, setDebugRenderMode] = useState<TrendDebugRenderMode>("prod");
  const [curveOverride, setCurveOverride] = useState<TrendCurveMode | null>(null);
  const [debugNoLabels, setDebugNoLabels] = useState(false);
  const [debugNoEndpoint, setDebugNoEndpoint] = useState(false);
  const [debugNoPeakLabel, setDebugNoPeakLabel] = useState(false);
  const [debugWidePadding, setDebugWidePadding] = useState(false);
  const [debugWideTopPadding, setDebugWideTopPadding] = useState(false);
  const normalized = useMemo(() => normalizeTrendPoints(points, kind), [points, kind]);
  const cleanedPoints = useMemo(() => ensureRenderableTrendSeries(normalized.points), [normalized.points]);
  const windowSlice = useMemo(() => filterTrendPoints(cleanedPoints, range), [cleanedPoints, range]);
  const visibleRawPoints = useMemo(() => trimLeadingInvalidTrendBaseline(windowSlice, kind), [windowSlice, kind]);
  const pointsForRender = useMemo(
    () => (debugRenderMode === "synthetic-pad" ? applySyntheticPaddingForDebug(visibleRawPoints) : visibleRawPoints),
    [debugRenderMode, visibleRawPoints]
  );
  const visibleRenderPoints = useMemo(() => addGapMarkers(pointsForRender), [pointsForRender]);
  const rightGutter = debugWidePadding ? TREND_WIDE_RIGHT_GUTTER : TREND_DEFAULT_RIGHT_GUTTER;
  const plotWidth = TREND_SVG_WIDTH - TREND_PLOT_LEFT - rightGutter;
  const preferLinearTail = kind === "currency" && shouldPreferLinearOnTail(visibleRawPoints);
  const curve: TrendCurveMode =
    curveOverride ?? (kind === "currency" ? (preferLinearTail ? "linear" : "monotone") : "monotone");
  const chart = useMemo(() => buildChart(visibleRenderPoints, plotWidth, TREND_SVG_HEIGHT, curve), [visibleRenderPoints, plotWidth, curve]);
  const singlePoint = !chart && visibleRawPoints.length === 1 ? visibleRawPoints[0]! : null;
  const windowStats = useMemo(() => {
    const vals = visibleRawPoints.map((p) => p.v).filter((v) => Number.isFinite(v));
    if (vals.length === 0) return { min: 0, max: 0 };
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }, [visibleRawPoints]);
  const formatTrendValue = (v: number) => formatTrendCardNumeric(v, kind, windowStats.min, windowStats.max);
  const delta =
    visibleRawPoints.length >= 2
      ? formatDetailTrendWindowDeltaPercent(
          visibleRawPoints[0]!.v,
          visibleRawPoints[visibleRawPoints.length - 1]!.v,
          kind
        )
      : null;
  const firstPoint = visibleRawPoints[0] ?? null;
  const lastPoint = visibleRawPoints[visibleRawPoints.length - 1] ?? null;
  const minPoint = visibleRawPoints.reduce<FundDetailTrendPoint | null>(
    (lowest, current) => (!lowest || current.v < lowest.v ? current : lowest),
    null
  );
  const maxPoint = visibleRawPoints.reduce<FundDetailTrendPoint | null>(
    (highest, current) => (!highest || current.v > highest.v ? current : highest),
    null
  );
  /** Üst blok: her zaman pencere sonu (güncel seviye); hover burayı değiştirmez. */
  const headerLevelPoint = lastPoint;
  const hoverPoint =
    hoveredIndex != null && hoveredIndex >= 0 && hoveredIndex < visibleRawPoints.length
      ? visibleRawPoints[hoveredIndex]
      : null;
  const xMinT = visibleRawPoints[0]?.t ?? 0;
  const xMaxT = visibleRawPoints[visibleRawPoints.length - 1]?.t ?? xMinT;
  const xSpanT = Math.max(1, xMaxT - xMinT);
  const pointX = (t: number) => TREND_PLOT_LEFT + ((t - xMinT) / xSpanT) * plotWidth;
  const axisMin = chart?.yMin ?? (minPoint?.v ?? 0);
  const axisMax = chart?.yMax ?? (maxPoint?.v ?? 0);
  const axisSpan = axisMax - axisMin || 1;
  const plotTop = debugWideTopPadding ? 14 : 10;
  const plotBottom = 12;
  const plotHeight = TREND_SVG_HEIGHT - plotTop - plotBottom;

  const yAxisLabels = useMemo(() => {
    if (!chart) return [] as Array<{ py: number; text: string }>;
    const { yMin, yMax } = chart;
    const span = yMax - yMin || 1;
    const plotH = plotHeight;
    const pys = [12, 64, 116];
    return pys.map((py) => {
      const v = yMin + (1 - (py - plotTop) / plotH) * span;
      return { py, text: formatTrendCardNumeric(v, kind, windowStats.min, windowStats.max) };
    });
  }, [chart, kind, plotHeight, plotTop, windowStats.min, windowStats.max]);

  const clearTrendHover = () => setHoveredIndex(null);

  useEffect(() => {
    setHoveredIndex(null);
  }, [range, visibleRawPoints.length, xMinT, xMaxT]);

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || visibleRawPoints.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left;
    if (!Number.isFinite(x) || rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, x / rect.width));
    const localX = Math.min(plotWidth, Math.max(0, ratio * TREND_SVG_WIDTH - TREND_PLOT_LEFT));
    const targetT = xMinT + (localX / Math.max(1, plotWidth)) * xSpanT;
    let index = 0;
    let bestDistance = Math.abs((visibleRawPoints[0]?.t ?? targetT) - targetT);
    for (let i = 1; i < visibleRawPoints.length; i += 1) {
      const distance = Math.abs(visibleRawPoints[i]!.t - targetT);
      if (distance < bestDistance) {
        bestDistance = distance;
        index = i;
      }
    }
    setHoveredIndex(index);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const mode = parseTrendRenderMode(params.get("trendRenderDebug"));
    const curveMode = parseTrendCurveMode(params.get("trendCurve"));
    setDebugRenderMode(mode);
    setCurveOverride(curveMode);
    setDebugNoLabels(parseTruthyFlag(params.get("trendNoLabels")));
    setDebugNoEndpoint(parseTruthyFlag(params.get("trendNoEndpoint")));
    setDebugNoPeakLabel(parseTruthyFlag(params.get("trendNoPeakLabel")));
    setDebugWidePadding(parseTruthyFlag(params.get("trendWideRightPad")));
    setDebugWideTopPadding(parseTruthyFlag(params.get("trendWideTopPad")));
  }, []);

  useEffect(() => {
    if (!DEBUG_TREND_CODES.has(fundCode.toUpperCase())) return;
    const uniqX = new Set(visibleRawPoints.map((item) => item.t)).size;
    const hasBadY = visibleRawPoints.some((item) => !Number.isFinite(item.v));
    let gapCount = 0;
    for (let index = 1; index < pointsForRender.length; index += 1) {
      if (pointsForRender[index]!.t - pointsForRender[index - 1]!.t > DAY_MS * 14) gapCount += 1;
    }
    console.info(
      `[trend-chart-sanitize] code=${fundCode} title="${title}" range=${range} raw_points=${normalized.stats.rawCount} ` +
        `cleaned_points=${normalized.stats.cleanedCount} duplicates_removed=${normalized.stats.duplicateTimestampRemoved} ` +
        `invalid_removed=${normalized.stats.invalidRemoved} domain_removed=${normalized.stats.outOfDomainRemoved} ` +
        `window_points=${windowSlice.length} render_points=${visibleRawPoints.length} ` +
        `min_t=${normalized.stats.minT ?? "none"} max_t=${normalized.stats.maxT ?? "none"} ` +
        `duplicate_x_after=${uniqX !== visibleRawPoints.length ? 1 : 0} bad_y_after=${hasBadY ? 1 : 0}`
    );
    console.info(
      `[trend-chart-render-mode] code=${fundCode} title="${title}" range=${range} mode=${debugRenderMode} curve=${curve} ` +
        `chart_segments=${chart?.lines.length ?? 0} area_segments=${chart?.areas.length ?? 0} gap_count=${gapCount} ` +
        `points_for_render=${pointsForRender.length} plot_width=${plotWidth} right_gutter=${rightGutter} ` +
        `wide_pad=${debugWidePadding ? 1 : 0} wide_top=${debugWideTopPadding ? 1 : 0} no_labels=${debugNoLabels ? 1 : 0} ` +
        `no_endpoint=${debugNoEndpoint ? 1 : 0} no_peak=${debugNoPeakLabel ? 1 : 0} linear_tail=${preferLinearTail ? 1 : 0}`
    );
  }, [chart?.areas.length, chart?.lines.length, curve, debugNoEndpoint, debugNoLabels, debugNoPeakLabel, debugRenderMode, debugWidePadding, debugWideTopPadding, fundCode, normalized.stats, plotWidth, pointsForRender, preferLinearTail, range, rightGutter, title, visibleRawPoints, windowSlice.length]);

  const showLine = debugRenderMode !== "area-only";
  const showArea = debugRenderMode !== "line-only";
  const useFlatFill = debugRenderMode === "flat-fill";
  const hasLargeGap = useMemo(() => {
    for (let index = 1; index < pointsForRender.length; index += 1) {
      if (pointsForRender[index]!.t - pointsForRender[index - 1]!.t > DAY_MS * 14) return true;
    }
    return false;
  }, [pointsForRender]);
  const canRenderArea =
    showArea &&
    visibleRawPoints.length >= 8 &&
    (debugRenderMode === "prod" ? !hasLargeGap && (chart?.areas.length ?? 0) <= 1 : true);

  return (
    <article
      className="rounded-[1.05rem] border px-3.5 py-3.5 sm:px-4 sm:py-4"
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 72%, transparent)",
        background: "var(--card-bg)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      <div className="flex min-h-[2.85rem] items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.11em]" style={{ color: "var(--text-muted)" }}>
            {eyebrow}
          </p>
          <h3 className="mt-1 text-[15px] font-semibold leading-tight tracking-[-0.02em] sm:text-[16px]" style={{ color: "var(--text-primary)" }}>
            {title}
          </h3>
        </div>
        <RangeSwitcher range={range} onChange={onRangeChange} ariaLabel={`${title} zaman aralığı`} />
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-3 sm:gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium" style={{ color: "var(--text-tertiary)" }}>
            Güncel seviye
          </p>
          <p className="mt-1 text-[1.12rem] font-semibold tabular-nums tracking-[-0.03em] sm:text-[1.28rem]" style={{ color: "var(--text-primary)" }}>
            {formatTrendValue(headerLevelPoint?.v ?? currentValue)}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
            {headerLevelPoint ? formatTrendTooltipDate(headerLevelPoint.t) : "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium" style={{ color: "var(--text-tertiary)" }}>
            Dönem değişimi
          </p>
          <p
            className="mt-1 text-[12px] font-semibold tabular-nums tracking-[-0.02em] sm:text-[13px]"
            style={{
              color:
                delta == null
                  ? "var(--text-secondary)"
                  : delta.startsWith("-")
                    ? "var(--danger)"
                    : delta.startsWith("+")
                      ? "var(--success)"
                      : "var(--text-secondary)",
            }}
            title={delta == null && visibleRawPoints.length >= 2 ? "Dönem uçları güvenilir değil veya değişim çok uç" : undefined}
          >
            {delta ?? "—"}
          </p>
          {singlePoint ? (
            <p className="mt-0.5 max-w-[11rem] text-[9.5px] leading-snug sm:max-w-[13rem]" style={{ color: "var(--text-muted)" }}>
              Tek veri noktası mevcut
            </p>
          ) : delta == null && visibleRawPoints.length >= 2 ? (
            <p className="mt-0.5 max-w-[11rem] text-[9.5px] leading-snug sm:max-w-[13rem]" style={{ color: "var(--text-muted)" }}>
              Kapsam yetersiz
            </p>
          ) : null}
        </div>
      </div>

      <div
        className="mt-3 overflow-hidden rounded-[0.95rem] border px-2.5 py-2.5 sm:px-3 sm:py-2.75"
        style={{
          borderColor: "color-mix(in srgb, var(--border-subtle) 52%, transparent)",
          background: "color-mix(in srgb, var(--bg-muted) 48%, var(--card-bg))",
        }}
      >
        {chart ? (
          <>
            <div
              className="w-full"
              style={{ aspectRatio: "320 / 128" }}
              onPointerLeave={clearTrendHover}
              onPointerCancel={clearTrendHover}
            >
              <svg
                ref={svgRef}
                viewBox={`0 0 ${TREND_SVG_WIDTH} ${TREND_SVG_HEIGHT}`}
                className="h-full w-full cursor-crosshair"
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label={`${title} trendi`}
                onPointerMove={handlePointerMove}
                onPointerLeave={clearTrendHover}
              >
                <defs>
                  <linearGradient id={`${chartId}-fill`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.11" />
                    <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0.015" />
                  </linearGradient>
                </defs>
                {!debugNoLabels ? yAxisLabels.map(({ py, text }) => (
                  <text
                    key={`yl-${py}`}
                    x={TREND_PLOT_LEFT + plotWidth + 3}
                    y={py}
                    textAnchor="start"
                    dominantBaseline="middle"
                    fill="var(--text-tertiary)"
                    fontSize={8.5}
                    fontWeight={500}
                    opacity={0.84}
                    className="tabular-nums"
                  >
                    {text}
                  </text>
                )) : null}
                <line x1={TREND_PLOT_LEFT} y1="12" x2={TREND_PLOT_LEFT + plotWidth} y2="12" stroke="var(--border-subtle)" strokeOpacity="0.12" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                <line x1={TREND_PLOT_LEFT} y1="64" x2={TREND_PLOT_LEFT + plotWidth} y2="64" stroke="var(--border-subtle)" strokeOpacity="0.1" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                <line x1={TREND_PLOT_LEFT} y1="116" x2={TREND_PLOT_LEFT + plotWidth} y2="116" stroke="var(--border-subtle)" strokeOpacity="0.12" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                <g transform={`translate(${TREND_PLOT_LEFT} 0)`}>
                {chart.areas.map((areaPath, index) =>
                  canRenderArea ? (
                    <path
                      key={`area-${index}`}
                      d={areaPath}
                      fill={useFlatFill ? "color-mix(in srgb, var(--accent-blue) 14%, transparent)" : `url(#${chartId}-fill)`}
                    />
                  ) : null
                )}
                {showLine
                  ? chart.lines.map((linePath, index) => (
                  <path
                    key={`line-${index}`}
                    d={linePath}
                    fill="none"
                    stroke="var(--accent-blue)"
                    strokeOpacity={curve === "monotone" ? 0.96 : 0.94}
                    strokeWidth={curve === "monotone" ? 1.42 : 1.58}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                    ))
                  : null}
                </g>
                {lastPoint && !hoverPoint && !debugNoEndpoint ? (
                  <g pointerEvents="none" opacity={0.88}>
                    <circle
                      cx={pointX(lastPoint.t)}
                      cy={plotTop + (1 - (lastPoint.v - axisMin) / axisSpan) * plotHeight}
                      r={2.5}
                      fill="var(--card-bg)"
                      stroke="var(--accent-blue)"
                      strokeWidth={1.2}
                      strokeOpacity={0.72}
                    />
                  </g>
                ) : null}
                {hoverPoint ? (
                  <>
                    <line
                      x1={pointX(hoverPoint.t)}
                      y1={plotTop}
                      x2={pointX(hoverPoint.t)}
                      y2={plotTop + plotHeight}
                      stroke="var(--accent-blue)"
                      strokeOpacity="0.18"
                      strokeWidth="1"
                      strokeDasharray="3 4"
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={pointX(hoverPoint.t)}
                      cy={plotTop + (1 - (hoverPoint.v - axisMin) / axisSpan) * plotHeight}
                      r="2.85"
                      fill="var(--card-bg)"
                      stroke="var(--accent-blue)"
                      strokeWidth="1.35"
                      strokeOpacity={0.88}
                    />
                    <circle
                      cx={pointX(hoverPoint.t)}
                      cy={plotTop + (1 - (hoverPoint.v - axisMin) / axisSpan) * plotHeight}
                      r="1.35"
                      fill="var(--accent-blue)"
                      fillOpacity={0.95}
                    />
                    <g pointerEvents="none" transform={`translate(${Math.min(214, Math.max(6, pointX(hoverPoint.t) - 52))},78)`}>
                      <rect width={100} height={28} rx={6} fill="var(--card-bg)" stroke="color-mix(in srgb, var(--border-subtle) 70%, transparent)" strokeWidth={1} opacity={0.96} />
                      <text x={50} y={12} textAnchor="middle" fill="var(--text-muted)" fontSize={8} fontWeight={600}>
                        {formatTrendTooltipDate(hoverPoint.t)}
                      </text>
                      <text x={50} y={22} textAnchor="middle" fill="var(--text-primary)" fontSize={9.5} fontWeight={600} className="tabular-nums">
                        {formatTrendValue(hoverPoint.v)}
                      </text>
                    </g>
                  </>
                ) : null}
              </svg>
            </div>
            {!debugNoLabels ? (
              <div className="mt-1.5 flex items-center justify-between text-[10px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                <span>{firstPoint ? formatTrendDate(firstPoint.t) : "—"}</span>
                <span>{lastPoint ? formatTrendDate(lastPoint.t) : "—"}</span>
              </div>
            ) : null}
          </>
        ) : singlePoint ? (
          <div className="rounded-[0.75rem] border px-2.5 py-2" style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 58%, transparent)", background: "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))" }}>
            <p className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
              Trend için tek tarihli gözlem var
            </p>
            <p className="mt-1 text-[10.5px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>
              {formatTrendTooltipDate(singlePoint.t)} · {formatTrendValue(singlePoint.v)}
            </p>
          </div>
        ) : (
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
            Trend için yeterli geçmiş henüz oluşmadı.
          </p>
        )}
        {visibleRawPoints.length >= 2 && !debugNoPeakLabel ? (
          <dl className="mt-2 grid grid-cols-2 gap-1.5 sm:gap-2">
            <div
              className="rounded-[0.65rem] border px-2.5 py-1.5 shadow-[var(--shadow-xs)] sm:px-2.5 sm:py-2"
              style={{
                borderColor: "color-mix(in srgb, var(--border-subtle) 58%, transparent)",
                background: "color-mix(in srgb, var(--card-bg) 94%, var(--bg-muted))",
              }}
            >
              <dt className="text-[9px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
                Dip
              </dt>
              <dd className="mt-0.5 text-[11.5px] font-semibold tabular-nums tracking-[-0.015em] sm:text-xs" style={{ color: "var(--text-primary)" }}>
                {minPoint ? formatTrendValue(minPoint.v) : "—"}
              </dd>
            </div>
            <div
              className="rounded-[0.65rem] border px-2.5 py-1.5 shadow-[var(--shadow-xs)] sm:px-2.5 sm:py-2"
              style={{
                borderColor: "color-mix(in srgb, var(--border-subtle) 58%, transparent)",
                background: "color-mix(in srgb, var(--card-bg) 94%, var(--bg-muted))",
              }}
            >
              <dt className="text-[9px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
                Zirve
              </dt>
              <dd className="mt-0.5 text-[11.5px] font-semibold tabular-nums tracking-[-0.015em] sm:text-xs" style={{ color: "var(--text-primary)" }}>
                {maxPoint ? formatTrendValue(maxPoint.v) : "—"}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>
    </article>
  );
}

export function FundDetailTrends({ data }: Props) {
  const [range, setRange] = useState<TrendRangeId>("3y");
  const behavior = useMemo(() => deriveFundDetailBehaviorContract(data), [data]);
  const investorTrendRenderable = hasRenderableTrendPayload(data.trendSeries.investorCount, "count");
  const portfolioTrendRenderable = hasRenderableTrendPayload(data.trendSeries.portfolioSize, "currency");
  // İki trend kartı birbirinden bağımsızdır: birinin zayıf verisi diğerini gizlememeli.
  const trendsHaveRenderablePayload = investorTrendRenderable || portfolioTrendRenderable;
  const trendsAvailable = shouldRenderSectionFromContract(behavior.canRenderTrendCharts, trendsHaveRenderablePayload);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.info(
      `[fund-detail-trends-visibility] code=${data.fund.code} canRenderTrendCharts=${behavior.canRenderTrendCharts ? 1 : 0} ` +
        `payload=${trendsHaveRenderablePayload ? 1 : 0} visible=${trendsAvailable ? 1 : 0} ` +
        `investorRenderable=${investorTrendRenderable ? 1 : 0} portfolioRenderable=${portfolioTrendRenderable ? 1 : 0} ` +
        `investorPoints=${data.trendSeries.investorCount.length} portfolioPoints=${data.trendSeries.portfolioSize.length}`
    );
  }, [
    behavior.canRenderTrendCharts,
    data.fund.code,
    investorTrendRenderable,
    portfolioTrendRenderable,
    data.trendSeries.investorCount.length,
    data.trendSeries.portfolioSize.length,
    trendsAvailable,
    trendsHaveRenderablePayload,
  ]);

  const content = trendsAvailable ? (
    <div className="grid gap-3 sm:grid-cols-2">
      <TrendMetricCard
        fundCode={data.fund.code}
        eyebrow="Talep"
        title="Yatırımcı Sayısı"
        currentValue={data.fund.investorCount}
        points={data.trendSeries.investorCount}
        kind="count"
        range={range}
        onRangeChange={setRange}
      />
      <TrendMetricCard
        fundCode={data.fund.code}
        eyebrow="Ölçek"
        title="Fon Toplam Değeri"
        currentValue={data.fund.portfolioSize}
        points={data.trendSeries.portfolioSize}
        kind="currency"
        range={range}
        onRangeChange={setRange}
      />
    </div>
  ) : (
    <div
      className="rounded-xl border px-3 py-3 text-[11px] leading-relaxed sm:px-3.5 sm:py-3.5 sm:text-[11.5px]"
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
        background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
        color: "var(--text-secondary)",
      }}
    >
      <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
        {behavior.trendFallbackCopy}
      </p>
      <p className="mt-1 text-[10px] sm:text-[10.5px]" style={{ color: "var(--text-muted)" }}>
        Daha geniş dönem verisi oluştuğunda bu alan otomatik zenginleşir.
      </p>
    </div>
  );

  return (
    <>
      <div className="md:hidden">
        <MobileDetailAccordion
          title="Fon Trendleri"
          hint="Yatırımcı ve portföy trendi (grafikle aynı bölüm)."
          defaultOpen={false}
        >
          {content}
        </MobileDetailAccordion>
      </div>

      <section aria-labelledby="fund-detail-trends-heading" className="hidden md:block">
        <div className="flex items-end justify-between gap-4">
          <div>
            <FundDetailSectionTitle id="fund-detail-trends-heading">Fon Trendleri</FundDetailSectionTitle>
            <p className="mt-1.5 text-[12px] leading-relaxed sm:text-[13px]" style={{ color: "var(--text-tertiary)" }}>
              Yatırımcı tabanı ve fon büyüklüğü, seçili pencerede.
            </p>
          </div>
        </div>
        <div className="mt-2">{content}</div>
      </section>
    </>
  );
}

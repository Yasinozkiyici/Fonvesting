"use client";

import { useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { MobileDetailAccordion } from "@/components/fund/MobileDetailAccordion";
import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import {
  buildLinearClosedAreaPathD,
  buildLinearPathD,
  buildMonotoneClosedAreaPathD,
  buildMonotoneXPathD,
  type ChartPathPoint,
} from "@/lib/chart-monotone-path";
import { formatDetailTrendWindowDeltaPercent, formatTrendCardNumeric } from "@/lib/fund-detail-format";
import type { FundDetailPageData, FundDetailTrendPoint } from "@/lib/services/fund-detail.service";

type Props = { data: FundDetailPageData };
const DAY_MS = 86400000;
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

function formatTrendDate(timestamp: number): string {
  return new Intl.DateTimeFormat("tr-TR", { month: "short", year: "2-digit" }).format(new Date(timestamp));
}

function formatTrendTooltipDate(timestamp: number): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(timestamp));
}

function normalizeTrendPoints(points: FundDetailTrendPoint[], kind: TrendKind): FundDetailTrendPoint[] {
  if (points.length === 0) return [];
  const sorted = [...points]
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.v))
    .sort((a, b) => a.t - b.t);

  const byTimestamp = new Map<number, number>();
  for (const point of sorted) {
    if (kind === "currency" && point.v <= 0) continue;
    if (kind === "count" && point.v < 0) continue;
    byTimestamp.set(point.t, point.v);
  }

  return [...byTimestamp.entries()].map(([t, v]) => ({ t, v }));
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

function addGapMarkers(points: FundDetailTrendPoint[]): TrendRenderPoint[] {
  if (points.length < 2) return points;
  const result: TrendRenderPoint[] = [points[0]!];
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1]!;
    const current = points[index]!;
    if (current.t - prev.t > DAY_MS * 14) {
      result.push({ ...current, gapBefore: true });
      continue;
    }
    result.push(current);
  }
  return result;
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

type TrendCurveMode = "linear" | "monotone";

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
    const xy = s.map((p) => toXY(p.t, p.v));
    const lineD =
      curve === "monotone" ? buildMonotoneXPathD(xy) : buildLinearPathD(xy);
    if (!lineD) continue;
    lines.push(lineD);
    const areaD =
      curve === "monotone"
        ? buildMonotoneClosedAreaPathD(xy, bottomY)
        : buildLinearClosedAreaPathD(xy, bottomY);
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
  eyebrow,
  title,
  currentValue,
  points,
  kind,
  range,
  onRangeChange,
}: {
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
  const cleanedPoints = useMemo(() => normalizeTrendPoints(points, kind), [points, kind]);
  const windowSlice = useMemo(() => filterTrendPoints(cleanedPoints, range), [cleanedPoints, range]);
  const visibleRawPoints = useMemo(() => trimLeadingInvalidTrendBaseline(windowSlice, kind), [windowSlice, kind]);
  const visibleRenderPoints = useMemo(() => addGapMarkers(visibleRawPoints), [visibleRawPoints]);
  const curve: TrendCurveMode = kind === "currency" ? "monotone" : "linear";
  const chart = useMemo(() => buildChart(visibleRenderPoints, 320, 128, curve), [visibleRenderPoints, curve]);
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
  const activePoint =
    hoveredIndex != null && hoveredIndex >= 0 && hoveredIndex < visibleRawPoints.length
      ? visibleRawPoints[hoveredIndex]
      : lastPoint;
  const xMinT = visibleRawPoints[0]?.t ?? 0;
  const xMaxT = visibleRawPoints[visibleRawPoints.length - 1]?.t ?? xMinT;
  const xSpanT = Math.max(1, xMaxT - xMinT);
  const pointX = (t: number) => ((t - xMinT) / xSpanT) * 320;
  const axisMin = chart?.yMin ?? (minPoint?.v ?? 0);
  const axisMax = chart?.yMax ?? (maxPoint?.v ?? 0);
  const axisSpan = axisMax - axisMin || 1;

  const yAxisLabels = useMemo(() => {
    if (!chart) return [] as Array<{ py: number; text: string }>;
    const { yMin, yMax } = chart;
    const span = yMax - yMin || 1;
    const plotTop = 10;
    const plotH = 106;
    const pys = [12, 64, 116];
    return pys.map((py) => {
      const v = yMin + (1 - (py - plotTop) / plotH) * span;
      return { py, text: formatTrendCardNumeric(v, kind, windowStats.min, windowStats.max) };
    });
  }, [chart, kind, windowStats.min, windowStats.max]);

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || visibleRawPoints.length === 0) return;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm.inverse());
    const ratio = Math.min(1, Math.max(0, local.x / 320));
    const targetT = xMinT + ratio * xSpanT;
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
            {hoveredIndex == null ? "Güncel seviye" : "Seçili tarih"}
          </p>
          <p className="mt-1 text-[1.12rem] font-semibold tabular-nums tracking-[-0.03em] sm:text-[1.28rem]" style={{ color: "var(--text-primary)" }}>
            {formatTrendValue(activePoint?.v ?? currentValue)}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
            {activePoint ? formatTrendTooltipDate(activePoint.t) : "—"}
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
          {delta == null && visibleRawPoints.length >= 2 ? (
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
            <div className="w-full" style={{ aspectRatio: "320 / 128" }}>
              <svg
                ref={svgRef}
                viewBox="0 0 320 128"
                className="h-full w-full cursor-crosshair"
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label={`${title} trendi`}
                onPointerMove={handlePointerMove}
                onPointerLeave={() => {
                  setHoveredIndex(null);
                }}
              >
                <defs>
                  <linearGradient id={`${chartId}-fill`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.11" />
                    <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0.015" />
                  </linearGradient>
                </defs>
                {yAxisLabels.map(({ py, text }) => (
                  <text
                    key={`yl-${py}`}
                    x={308}
                    y={py}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fill="var(--text-tertiary)"
                    fontSize={8.5}
                    fontWeight={500}
                    opacity={0.84}
                    className="tabular-nums"
                  >
                    {text}
                  </text>
                ))}
                <line x1="0" y1="12" x2="302" y2="12" stroke="var(--border-subtle)" strokeOpacity="0.12" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                <line x1="0" y1="64" x2="302" y2="64" stroke="var(--border-subtle)" strokeOpacity="0.1" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                <line x1="0" y1="116" x2="302" y2="116" stroke="var(--border-subtle)" strokeOpacity="0.12" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                {chart.areas.map((areaPath, index) => (
                  <path key={`area-${index}`} d={areaPath} fill={`url(#${chartId}-fill)`} />
                ))}
                {chart.lines.map((linePath, index) => (
                  <path
                    key={`line-${index}`}
                    d={linePath}
                    fill="none"
                    stroke="var(--accent-blue)"
                    strokeOpacity={curve === "monotone" ? 0.92 : 0.9}
                    strokeWidth={curve === "monotone" ? 1.42 : 1.58}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {activePoint ? (
                  <>
                    <line
                      x1={pointX(activePoint.t)}
                      y1="10"
                      x2={pointX(activePoint.t)}
                      y2="116"
                      stroke="var(--accent-blue)"
                      strokeOpacity="0.18"
                      strokeWidth="1"
                      strokeDasharray="3 4"
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={pointX(activePoint.t)}
                      cy={10 + (1 - (activePoint.v - axisMin) / axisSpan) * 106}
                      r="2.85"
                      fill="var(--card-bg)"
                      stroke="var(--accent-blue)"
                      strokeWidth="1.35"
                      strokeOpacity={0.88}
                    />
                    <circle
                      cx={pointX(activePoint.t)}
                      cy={10 + (1 - (activePoint.v - axisMin) / axisSpan) * 106}
                      r="1.35"
                      fill="var(--accent-blue)"
                      fillOpacity={0.95}
                    />
                  </>
                ) : null}
              </svg>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px] tabular-nums" style={{ color: "var(--text-tertiary)" }}>
              <span>{firstPoint ? formatTrendDate(firstPoint.t) : "—"}</span>
              <span>{lastPoint ? formatTrendDate(lastPoint.t) : "—"}</span>
            </div>
          </>
        ) : (
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
            Trend için yeterli geçmiş henüz oluşmadı.
          </p>
        )}

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
      </div>
    </article>
  );
}

export function FundDetailTrends({ data }: Props) {
  const [range, setRange] = useState<TrendRangeId>("3y");

  const content = (
    <div className="grid gap-3 sm:grid-cols-2">
      <TrendMetricCard
        eyebrow="Talep"
        title="Yatırımcı Sayısı"
        currentValue={data.fund.investorCount}
        points={data.trendSeries.investorCount}
        kind="count"
        range={range}
        onRangeChange={setRange}
      />
      <TrendMetricCard
        eyebrow="Ölçek"
        title="Fon Toplam Değeri"
        currentValue={data.fund.portfolioSize}
        points={data.trendSeries.portfolioSize}
        kind="currency"
        range={range}
        onRangeChange={setRange}
      />
    </div>
  );

  return (
    <>
      <div className="md:hidden">
        <MobileDetailAccordion
          title="Fon Trendleri"
          hint="Yatırımcı tabanı ve fon büyüklüğündeki değişimi özetler."
          defaultOpen
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

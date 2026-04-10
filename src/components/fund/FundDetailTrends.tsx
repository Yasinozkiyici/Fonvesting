"use client";

import { useMemo, useRef, useState } from "react";
import { MobileDetailAccordion } from "@/components/fund/MobileDetailAccordion";
import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import { formatCompactCurrency, formatCompactNumber } from "@/lib/fund-list-format";
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
type TrendRenderPoint = FundDetailTrendPoint & { gapBefore?: boolean };

function formatTrendDate(timestamp: number): string {
  return new Intl.DateTimeFormat("tr-TR", { month: "short", year: "2-digit" }).format(new Date(timestamp));
}

function formatTrendTooltipDate(timestamp: number): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(timestamp));
}

function formatMetricValue(value: number, kind: "currency" | "count"): string {
  return kind === "currency" ? formatCompactCurrency(value) : formatCompactNumber(value);
}

function formatDelta(points: FundDetailTrendPoint[]): string | null {
  if (points.length < 2) return null;
  const start = points[0]?.v ?? 0;
  const end = points[points.length - 1]?.v ?? 0;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) return null;
  const pct = (end / start - 1) * 100;
  if (!Number.isFinite(pct)) return null;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1).replace(".", ",")}%`;
}

function sanitizeTrendPoints(points: FundDetailTrendPoint[]): TrendRenderPoint[] {
  const valid = points.filter((point) => Number.isFinite(point.t) && Number.isFinite(point.v) && point.v >= 0);
  if (valid.length < 3) return valid;

  const dropped = new Set<number>();
  for (let index = 1; index < valid.length - 1; index += 1) {
    const prev = valid[index - 1]!;
    const current = valid[index]!;
    const next = valid[index + 1]!;
    if (prev.v <= 0 || current.v <= 0 || next.v <= 0) continue;

    const neighborBase = (prev.v + next.v) / 2;
    const neighborDrift = Math.max(prev.v, next.v) / Math.max(1, Math.min(prev.v, next.v));
    const currentDrift = Math.max(current.v, neighborBase) / Math.max(1, Math.min(current.v, neighborBase));

    if (neighborDrift <= 1.55 && currentDrift >= 4.5) {
      dropped.add(index);
    }
  }

  const sanitized: TrendRenderPoint[] = [];
  let gapPending = false;
  for (let index = 0; index < valid.length; index += 1) {
    if (dropped.has(index)) {
      gapPending = true;
      continue;
    }
    sanitized.push(gapPending ? { ...valid[index]!, gapBefore: true } : valid[index]!);
    gapPending = false;
  }
  return sanitized;
}

function buildChart(points: TrendRenderPoint[], width: number, height: number): {
  lines: string[];
  areas: string[];
} | null {
  if (points.length < 2) return null;
  const values = points.map((point) => point.v).filter((value) => Number.isFinite(value));
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / Math.max(1, points.length - 1);
  const lines: string[] = [];
  const areas: string[] = [];
  let segment: string[] = [];
  let segmentStartX = 0;
  let segmentEndX = 0;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const x = index * stepX;
    const y = height - ((point.v - min) / span) * height;

    if (point.gapBefore && segment.length >= 2) {
      lines.push(segment.join(" "));
      areas.push(`${segment.join(" ")} L ${segmentEndX.toFixed(2)} ${height.toFixed(2)} L ${segmentStartX.toFixed(2)} ${height.toFixed(2)} Z`);
      segment = [];
    }

    if (segment.length === 0) {
      segmentStartX = x;
      segment.push(`M ${x.toFixed(2)} ${y.toFixed(2)}`);
    } else {
      segment.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    segmentEndX = x;
  }

  if (segment.length >= 2) {
    lines.push(segment.join(" "));
    areas.push(`${segment.join(" ")} L ${segmentEndX.toFixed(2)} ${height.toFixed(2)} L ${segmentStartX.toFixed(2)} ${height.toFixed(2)} Z`);
  }

  if (lines.length === 0) return null;
  return { lines, areas };
}

function getNearestIndexByRatio(length: number, ratio: number): number {
  if (length <= 1) return 0;
  return Math.min(length - 1, Math.max(0, Math.round(ratio * (length - 1))));
}

function filterTrendPoints(points: FundDetailTrendPoint[], range: TrendRangeId): FundDetailTrendPoint[] {
  if (points.length < 2) return points;
  const selected = RANGE_OPTIONS.find((option) => option.id === range);
  if (!selected || selected.days == null) return points;
  const maxTime = points[points.length - 1]!.t;
  const minTime = maxTime - selected.days * DAY_MS;
  const filtered = points.filter((point) => point.t >= minTime);
  return filtered.length >= 2 ? filtered : points;
}

function TrendMetricCard({
  eyebrow,
  title,
  currentValue,
  points,
  kind,
}: {
  eyebrow: string;
  title: string;
  currentValue: number;
  points: FundDetailTrendPoint[];
  kind: "currency" | "count";
}) {
  const chartId = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [range, setRange] = useState<TrendRangeId>("3y");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const visiblePoints = useMemo(() => sanitizeTrendPoints(filterTrendPoints(points, range)), [points, range]);
  const chart = useMemo(() => buildChart(visiblePoints, 320, 112), [visiblePoints]);
  const delta = formatDelta(visiblePoints);
  const firstPoint = visiblePoints[0] ?? null;
  const lastPoint = visiblePoints[visiblePoints.length - 1] ?? null;
  const minPoint = visiblePoints.reduce<FundDetailTrendPoint | null>(
    (lowest, current) => (!lowest || current.v < lowest.v ? current : lowest),
    null
  );
  const maxPoint = visiblePoints.reduce<FundDetailTrendPoint | null>(
    (highest, current) => (!highest || current.v > highest.v ? current : highest),
    null
  );
  const activePoint =
    hoveredIndex != null && hoveredIndex >= 0 && hoveredIndex < visiblePoints.length
      ? visiblePoints[hoveredIndex]
      : lastPoint;
  const xDenominator = Math.max(1, visiblePoints.length - 1);
  const yMin = minPoint?.v ?? 0;
  const yMax = maxPoint?.v ?? 0;
  const ySpan = yMax - yMin || 1;

  const handlePointerMove = (clientX: number) => {
    if (!svgRef.current || visiblePoints.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    const width = rect.width || 1;
    const ratio = Math.min(1, Math.max(0, relativeX / width));
    const index = getNearestIndexByRatio(visiblePoints.length, ratio);
    setHoverX(ratio * 320);
    setHoveredIndex(index);
  };

  return (
    <article
      className="rounded-[1.05rem] border px-3 py-3 sm:px-3.5 sm:py-3.5"
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 78%, transparent)",
        background: "var(--card-bg)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.11em]" style={{ color: "var(--text-muted)" }}>
            {eyebrow}
          </p>
          <h3 className="mt-1 text-[15px] font-semibold tracking-[-0.02em] sm:text-[16px]" style={{ color: "var(--text-primary)" }}>
            {title}
          </h3>
        </div>
        <div
          className="rounded-full border px-2.5 py-1 text-[10px] font-medium tabular-nums"
          style={{
            borderColor: "color-mix(in srgb, var(--border-subtle) 86%, transparent)",
            background: "color-mix(in srgb, var(--card-bg) 94%, var(--bg-muted))",
            color: "var(--text-secondary)",
          }}
        >
          {RANGE_OPTIONS.find((option) => option.id === range)?.label ?? "3Y"}
        </div>
      </div>

      <div className="mt-2.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            {hoveredIndex == null ? "Güncel seviye" : "Seçili tarih"}
          </p>
          <p className="mt-0.5 text-[1.12rem] font-semibold tabular-nums tracking-[-0.03em] sm:text-[1.28rem]" style={{ color: "var(--text-primary)" }}>
            {formatMetricValue(activePoint?.v ?? currentValue, kind)}
          </p>
          <p className="mt-1 text-[11px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
            {activePoint ? formatTrendTooltipDate(activePoint.t) : "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            Dönem değişimi
          </p>
          <p
            className="mt-0.5 text-[12px] font-semibold tabular-nums sm:text-[13px]"
            style={{
              color: delta == null ? "var(--text-secondary)" : delta.startsWith("-") ? "var(--danger)" : "var(--success)",
            }}
          >
            {delta ?? "—"}
          </p>
        </div>
      </div>

      <div
        className="mt-2.5 inline-flex flex-wrap items-center gap-0.5 rounded-[10px] border p-0.5"
        style={{ borderColor: "var(--border-subtle)", background: "var(--surface-table-header)" }}
        role="tablist"
        aria-label={`${title} zaman aralığı`}
      >
        {RANGE_OPTIONS.map((option) => {
          const active = option.id === range;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setRange(option.id);
                setHoveredIndex(null);
                setHoverX(null);
              }}
              className="min-h-[1.75rem] min-w-[1.95rem] rounded-[8px] px-2.25 text-[10px] font-semibold tracking-[-0.015em] transition-[color,background,border-color,box-shadow] sm:text-[11px]"
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

      <div
        className="mt-2.5 overflow-hidden rounded-[0.95rem] border px-2.5 py-2 sm:px-3"
        style={{
          borderColor: "color-mix(in srgb, var(--border-subtle) 65%, transparent)",
          background: "color-mix(in srgb, var(--bg-muted) 58%, var(--card-bg))",
        }}
      >
        {chart ? (
          <>
            <div className="h-20 w-full sm:h-[5.75rem]">
              <svg
                ref={svgRef}
                viewBox="0 0 320 112"
                className="h-full w-full cursor-crosshair"
                preserveAspectRatio="none"
                role="img"
                aria-label={`${title} trendi`}
                onPointerMove={(event) => handlePointerMove(event.clientX)}
                onPointerLeave={() => {
                  setHoveredIndex(null);
                  setHoverX(null);
                }}
              >
                <defs>
                  <linearGradient id={`${chartId}-fill`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0.01" />
                  </linearGradient>
                </defs>
                {chart.areas.map((areaPath, index) => (
                  <path key={`area-${index}`} d={areaPath} fill={`url(#${chartId}-fill)`} />
                ))}
                {chart.lines.map((linePath, index) => (
                  <path
                    key={`line-${index}`}
                    d={linePath}
                    fill="none"
                    stroke="var(--accent-blue)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                {activePoint ? (
                  <>
                    <line
                      x1={hoverX ?? (hoveredIndex ?? xDenominator) * (320 / xDenominator)}
                      y1="0"
                      x2={hoverX ?? (hoveredIndex ?? xDenominator) * (320 / xDenominator)}
                      y2="112"
                      stroke="var(--accent-blue)"
                      strokeOpacity="0.26"
                      strokeWidth="1"
                      strokeDasharray="3 4"
                    />
                    <circle
                      cx={(hoveredIndex ?? xDenominator) * (320 / xDenominator)}
                      cy={112 - ((activePoint.v - yMin) / ySpan) * 112}
                      r="4"
                      fill="var(--card-bg)"
                      stroke="var(--accent-blue)"
                      strokeWidth="2"
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
      </div>

      <dl className="mt-2.5 grid grid-cols-2 gap-2">
        <div className="rounded-[0.9rem] border px-3 py-2" style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 86%, transparent)", background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))" }}>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.09em]" style={{ color: "var(--text-muted)" }}>
            Dip
          </dt>
          <dd className="mt-1 text-[13px] font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
            {minPoint ? formatMetricValue(minPoint.v, kind) : "—"}
          </dd>
        </div>
        <div className="rounded-[0.9rem] border px-3 py-2" style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 86%, transparent)", background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))" }}>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.09em]" style={{ color: "var(--text-muted)" }}>
            Zirve
          </dt>
          <dd className="mt-1 text-[13px] font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
            {maxPoint ? formatMetricValue(maxPoint.v, kind) : "—"}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function FundDetailTrends({ data }: Props) {
  const content = (
    <div className="grid gap-3 sm:grid-cols-2">
      <TrendMetricCard
        eyebrow="Talep"
        title="Yatırımcı Sayısı"
        currentValue={data.fund.investorCount}
        points={data.trendSeries.investorCount}
        kind="count"
      />
      <TrendMetricCard
        eyebrow="Ölçek"
        title="Fon Toplam Değeri"
        currentValue={data.fund.portfolioSize}
        points={data.trendSeries.portfolioSize}
        kind="currency"
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
            <p className="mt-1 text-[12px] leading-snug sm:text-[13px]" style={{ color: "var(--text-secondary)" }}>
              Son 3 yıl boyunca yatırımcı tabanı ve fon büyüklüğündeki değişim.
            </p>
          </div>
        </div>
        <div className="mt-2">{content}</div>
      </section>
    </>
  );
}

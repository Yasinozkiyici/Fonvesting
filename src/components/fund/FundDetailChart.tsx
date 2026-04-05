"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { FundDetailPricePoint } from "@/lib/services/fund-detail.service";
import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import { formatFundLastPrice } from "@/lib/fund-list-format";

const DAY_MS = 86400000;

const RANGES = [
  { id: "1m", label: "1A", days: 31 },
  { id: "3m", label: "3A", days: 93 },
  { id: "6m", label: "6A", days: 186 },
  { id: "1y", label: "1Y", days: 365 },
  { id: "all", label: "Tümü", days: null },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

/** Tüm eksen etiketleri viewBox içinde kalsın; dış sarmalayıcı aynı en-boy oranını kullanır (kesme/yer değiştirme olmaz). */
const VB_W = 820;
const VB_H = 264;
const PAD_L = 46;
const PAD_R = 16;
const PAD_T = 12;
const PAD_B = 34;
const PLOT_LEFT = PAD_L;
const PLOT_RIGHT = VB_W - PAD_R;
const PLOT_TOP = PAD_T;
const PLOT_BOTTOM = VB_H - PAD_B;
const INNER_W = PLOT_RIGHT - PLOT_LEFT;
const INNER_H = PLOT_BOTTOM - PLOT_TOP;
const X_LABEL_Y = PLOT_BOTTOM + 13;

function filterWindow(series: FundDetailPricePoint[], rangeId: RangeId): FundDetailPricePoint[] {
  if (series.length === 0) return [];
  const cfg = RANGES.find((r) => r.id === rangeId);
  if (!cfg || cfg.days == null) return series;
  const lastT = series[series.length - 1]!.t;
  const minT = lastT - cfg.days * DAY_MS;
  const win = series.filter((x) => x.t >= minT);
  return win.length >= 2 ? win : series;
}

function fmtIndexTr(v: number): string {
  return v.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fmtAxisDateShort(t: number): string {
  return new Date(t).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

type PlotBuild = {
  pathD: string;
  points: Array<{ x: number; y: number }>;
  yLevels: Array<{ value: number; y: number }>;
  minNorm: number;
  maxNorm: number;
};

function buildPlot(norm: number[]): PlotBuild | null {
  if (norm.length < 2) return null;
  const min = Math.min(...norm);
  const max = Math.max(...norm);
  const span = max - min || 1;
  const parts: string[] = [];
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < norm.length; i += 1) {
    const x = PLOT_LEFT + (i / (norm.length - 1)) * INNER_W;
    const y = PLOT_TOP + INNER_H - ((norm[i]! - min) / span) * INNER_H;
    points.push({ x, y });
    parts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  const midVal = min + span / 2;
  const yLevels = [
    { value: max, y: PLOT_TOP + INNER_H - ((max - min) / span) * INNER_H },
    { value: midVal, y: PLOT_TOP + INNER_H - ((midVal - min) / span) * INNER_H },
    { value: min, y: PLOT_TOP + INNER_H - ((min - min) / span) * INNER_H },
  ];
  return { pathD: parts.join(" "), points, yLevels, minNorm: min, maxNorm: max };
}

type Props = { series: FundDetailPricePoint[] };

export function FundDetailChart({ series }: Props) {
  const [range, setRange] = useState<RangeId>("1y");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<null | { idx: number; px: number; py: number }>(null);

  const windowed = useMemo(() => filterWindow(series, range), [series, range]);

  const { norm, periodReturnPct, startLabel, endLabel, windowedForTip } = useMemo(() => {
    if (windowed.length < 2) {
      return {
        norm: [] as number[],
        periodReturnPct: null as number | null,
        startLabel: "",
        endLabel: "",
        windowedForTip: [] as FundDetailPricePoint[],
      };
    }
    const p0 = windowed[0]!.p;
    const p1 = windowed[windowed.length - 1]!.p;
    if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 <= 0) {
      return {
        norm: [] as number[],
        periodReturnPct: null as number | null,
        startLabel: "",
        endLabel: "",
        windowedForTip: [] as FundDetailPricePoint[],
      };
    }
    const norm = windowed.map((pt) => (pt.p / p0) * 100);
    const periodReturnPct = (p1 / p0 - 1) * 100;
    const fmt = (t: number) =>
      new Date(t).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
    return {
      norm,
      periodReturnPct,
      startLabel: fmt(windowed[0]!.t),
      endLabel: fmt(windowed[windowed.length - 1]!.t),
      windowedForTip: windowed,
    };
  }, [windowed]);

  const plot = useMemo(() => buildPlot(norm), [norm]);

  const xAxisTicks = useMemo(() => {
    if (windowedForTip.length < 2) return [];
    const last = windowedForTip.length - 1;
    const mid = Math.floor(last / 2);
    const indices = [0, mid, last] as const;
    const uniq = [...new Set(indices)];
    return uniq.map((i) => ({
      i,
      t: windowedForTip[i]!.t,
      x: PLOT_LEFT + (i / last) * INNER_W,
    }));
  }, [windowedForTip]);

  const clearHover = useCallback(() => setHover(null), []);

  const onOverlayMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!plot || norm.length < 2) return;
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const xRatio = (e.clientX - r.left) / r.width;
      const clamped = Math.min(1, Math.max(0, xRatio));
      const idx = Math.min(norm.length - 1, Math.max(0, Math.round(clamped * (norm.length - 1))));
      setHover({
        idx,
        px: e.clientX - r.left,
        py: e.clientY - r.top,
      });
    },
    [plot, norm.length]
  );

  const tipData =
    hover && windowedForTip[hover.idx]
      ? {
          date: new Date(windowedForTip[hover.idx]!.t).toLocaleDateString("tr-TR", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
          price: formatFundLastPrice(windowedForTip[hover.idx]!.p),
          index: fmtIndexTr(norm[hover.idx] ?? 100),
        }
      : null;

  let tipStyle: { left: number; top: number } | null = null;
  if (hover && wrapRef.current) {
    const bw = wrapRef.current.clientWidth;
    const bh = wrapRef.current.clientHeight;
    const tw = 168;
    const th = 58;
    let left = hover.px + 12;
    let top = hover.py + 12;
    if (left + tw > bw) left = hover.px - tw - 12;
    if (top + th > bh) top = hover.py - th - 8;
    left = Math.max(8, Math.min(left, bw - tw - 8));
    top = Math.max(8, Math.min(top, bh - th - 8));
    tipStyle = { left, top };
  }

  return (
    <section aria-labelledby="fund-detail-chart-heading">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <div className="min-w-0 flex-1">
          <FundDetailSectionTitle id="fund-detail-chart-heading">Performans</FundDetailSectionTitle>
        </div>
        <div
          className="flex shrink-0 flex-wrap gap-0.5 rounded-[10px] border p-0.5 sm:gap-px"
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
                className="min-h-[2.125rem] min-w-[2.25rem] rounded-lg px-2.5 text-[11px] font-semibold tracking-[-0.02em] transition-[color,background,border-color,box-shadow] sm:px-3 sm:text-xs"
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
        className="mt-5 rounded-xl border px-4 py-5 sm:px-6 sm:py-6"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--card-bg)",
        }}
      >
        {norm.length < 2 ? (
          <p className="py-14 text-center text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Bu fon için yeterli fiyat geçmişi yok. Veri geldikçe grafik otomatik görünür.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1 border-b pb-5 sm:pb-6" style={{ borderColor: "var(--border-subtle)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
                Seçili dönem getirisi
              </p>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                {periodReturnPct != null && Number.isFinite(periodReturnPct) ? (
                  <span
                    className="tabular-nums text-2xl font-semibold tracking-[-0.03em] sm:text-[1.65rem]"
                    style={{
                      color:
                        periodReturnPct > 0
                          ? "var(--success)"
                          : periodReturnPct < 0
                            ? "var(--danger)"
                            : "var(--text-secondary)",
                    }}
                  >
                    {periodReturnPct > 0 ? "+" : ""}
                    {periodReturnPct.toFixed(2).replace(".", ",")}%
                  </span>
                ) : (
                  <span className="text-xl font-semibold" style={{ color: "var(--text-muted)" }}>
                    —
                  </span>
                )}
              </div>
              <p className="text-[11px] font-normal tabular-nums leading-snug sm:text-xs" style={{ color: "var(--text-tertiary)" }}>
                {startLabel}
                <span className="mx-1 opacity-40" aria-hidden>
                  ·
                </span>
                {endLabel}
              </p>
            </div>

            <div
              ref={wrapRef}
              className="relative mt-5 w-full touch-none overflow-visible pb-1 sm:pb-2"
              style={{ aspectRatio: `${VB_W} / ${VB_H}` }}
              onMouseLeave={clearHover}
              onMouseMove={onOverlayMove}
            >
              <svg
                viewBox={`0 0 ${VB_W} ${VB_H}`}
                className="absolute inset-0 h-full w-full max-w-full select-none"
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label="Fon birim fiyat performans grafiği, seçili dönemde dönem başına göre endekslenmiş"
              >
                {plot
                  ? plot.yLevels.map((lvl, i) => (
                      <g key={i}>
                        <line
                          x1={PLOT_LEFT}
                          y1={lvl.y}
                          x2={PLOT_RIGHT}
                          y2={lvl.y}
                          stroke="var(--border-subtle)"
                          strokeWidth={1}
                          vectorEffect="non-scaling-stroke"
                          opacity={0.35}
                        />
                        <text
                          x={PLOT_LEFT - 8}
                          y={lvl.y}
                          textAnchor="end"
                          dominantBaseline="middle"
                          fill="var(--text-tertiary)"
                          fontSize={10}
                          fontWeight={500}
                          opacity={0.72}
                          className="tabular-nums"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {fmtIndexTr(lvl.value)}
                        </text>
                      </g>
                    ))
                  : null}

                {plot ? (
                  <path
                    d={plot.pathD}
                    fill="none"
                    stroke="var(--accent-blue)"
                    strokeWidth={1.2}
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.92}
                  />
                ) : null}

                {plot && plot.points.length >= 2 ? (
                  <>
                    <circle
                      cx={plot.points[0]!.x}
                      cy={plot.points[0]!.y}
                      r={3}
                      fill="var(--card-bg)"
                      stroke="var(--accent-blue)"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      opacity={0.85}
                    />
                    <circle
                      cx={plot.points[plot.points.length - 1]!.x}
                      cy={plot.points[plot.points.length - 1]!.y}
                      r={3}
                      fill="var(--card-bg)"
                      stroke="var(--accent-blue)"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      opacity={0.85}
                    />
                  </>
                ) : null}

                {xAxisTicks.map((tick) => (
                  <text
                    key={tick.i}
                    x={tick.x}
                    y={X_LABEL_Y}
                    textAnchor="middle"
                    fill="var(--text-tertiary)"
                    fontSize={10}
                    fontWeight={500}
                    opacity={0.72}
                    className="tabular-nums"
                  >
                    {fmtAxisDateShort(tick.t)}
                  </text>
                ))}
              </svg>

              {hover && tipData && tipStyle ? (
                <div
                  className="pointer-events-none absolute z-10 rounded-md border px-2.5 py-2 shadow-sm tabular-nums"
                  style={{
                    left: tipStyle.left,
                    top: tipStyle.top,
                    width: 168,
                    borderColor: "var(--border-subtle)",
                    background: "var(--surface-glass-strong)",
                    color: "var(--text-primary)",
                    fontSize: 11,
                    lineHeight: 1.35,
                  }}
                  role="status"
                >
                  <div style={{ color: "var(--text-muted)", fontSize: 10 }}>{tipData.date}</div>
                  <div className="mt-0.5 font-semibold">{tipData.price}</div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 10 }}>Endeks (dönem başı 100): {tipData.index}</div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

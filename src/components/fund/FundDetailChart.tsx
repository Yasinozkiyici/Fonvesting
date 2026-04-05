"use client";

import { useMemo, useState } from "react";
import type { FundDetailPricePoint } from "@/lib/services/fund-detail.service";
import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";

const DAY_MS = 86400000;

const RANGES = [
  { id: "1m", label: "1A", days: 31 },
  { id: "3m", label: "3A", days: 93 },
  { id: "6m", label: "6A", days: 186 },
  { id: "1y", label: "1Y", days: 365 },
  { id: "all", label: "Tümü", days: null },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

function filterWindow(series: FundDetailPricePoint[], rangeId: RangeId): FundDetailPricePoint[] {
  if (series.length === 0) return [];
  const cfg = RANGES.find((r) => r.id === rangeId);
  if (!cfg || cfg.days == null) return series;
  const lastT = series[series.length - 1]!.t;
  const minT = lastT - cfg.days * DAY_MS;
  const win = series.filter((x) => x.t >= minT);
  return win.length >= 2 ? win : series;
}

function buildPathD(norm: number[], width: number, height: number, padX: number, padY: number): string {
  if (norm.length < 2) return "";
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const min = Math.min(...norm);
  const max = Math.max(...norm);
  const span = max - min || 1;
  const parts: string[] = [];
  for (let i = 0; i < norm.length; i += 1) {
    const x = padX + (i / (norm.length - 1)) * innerW;
    const y = padY + innerH - ((norm[i]! - min) / span) * innerH;
    parts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return parts.join(" ");
}

type Props = { series: FundDetailPricePoint[] };

export function FundDetailChart({ series }: Props) {
  const [range, setRange] = useState<RangeId>("1y");

  const windowed = useMemo(() => filterWindow(series, range), [series, range]);

  const { norm, periodReturnPct, startLabel, endLabel } = useMemo(() => {
    if (windowed.length < 2) {
      return { norm: [] as number[], periodReturnPct: null as number | null, startLabel: "", endLabel: "" };
    }
    const p0 = windowed[0]!.p;
    const p1 = windowed[windowed.length - 1]!.p;
    if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 <= 0) {
      return { norm: [] as number[], periodReturnPct: null as number | null, startLabel: "", endLabel: "" };
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
    };
  }, [windowed]);

  const w = 720;
  const h = 220;
  const padX = 4;
  const padY = 10;
  const pathD = norm.length >= 2 ? buildPathD(norm, w, h, padX, padY) : "";

  return (
    <section className="mt-8 sm:mt-10" aria-labelledby="fund-detail-chart-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <FundDetailSectionTitle id="fund-detail-chart-heading">Performans</FundDetailSectionTitle>
          <p className="mt-2 text-sm leading-snug" style={{ color: "var(--text-secondary)" }}>
            Birim fiyat — seçili aralıkta endeks 100 normalize edilmiş seri.
          </p>
        </div>
        <div
          className="flex flex-wrap gap-1 rounded-lg border p-0.5"
          style={{
            borderColor: "var(--border-subtle)",
            background: "var(--bg-muted)",
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
                className="min-h-[2rem] rounded-md px-2.5 text-[11px] font-semibold tracking-[-0.02em] transition-colors sm:px-3 sm:text-xs"
                style={{
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  background: active ? "var(--card-bg)" : "transparent",
                  boxShadow: active ? "var(--shadow-xs)" : "none",
                  border: active ? "1px solid var(--border-default)" : "1px solid transparent",
                }}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="mt-4 rounded-xl border px-3 py-4 sm:px-5 sm:py-5"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--card-bg)",
        }}
      >
        {norm.length < 2 ? (
          <p className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            Bu fon için yeterli fiyat geçmişi yok. Grafik yakında veri geldikçe görünecek.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  Dönem getirisi
                </span>
                {periodReturnPct != null && Number.isFinite(periodReturnPct) ? (
                  <span
                    className="tabular-nums text-lg font-semibold tracking-[-0.02em] sm:text-xl"
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
                  <span style={{ color: "var(--text-muted)" }}>—</span>
                )}
              </div>
              <p className="text-[11px] tabular-nums sm:text-xs" style={{ color: "var(--text-tertiary)" }}>
                {startLabel} — {endLabel}
              </p>
            </div>

            <div className="relative mt-4 w-full overflow-hidden" style={{ maxHeight: h }}>
              <svg
                viewBox={`0 0 ${w} ${h}`}
                className="block w-full"
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label="Fon birim fiyat performans grafiği"
              >
                {pathD ? (
                  <path
                    d={pathD}
                    fill="none"
                    stroke="var(--accent-blue)"
                    strokeWidth={1.35}
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null}
              </svg>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

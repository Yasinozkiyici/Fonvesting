"use client";

import { useState } from "react";
import type { RankingMode, NormalizedScores, FundMetrics, RiskLevel } from "@/lib/scoring";
import { getRiskLevelInfo, getScoreColor } from "@/lib/scoring";

/**
 * Ranking Mode Toggle - Refined segmented control
 */
interface RankingToggleProps {
  mode: RankingMode;
  onChange: (mode: RankingMode) => void;
}

const MODES: { key: RankingMode; label: string }[] = [
  { key: "BEST", label: "En İyi" },
  { key: "LOW_RISK", label: "Düşük Risk" },
  { key: "HIGH_RETURN", label: "Yüksek Getiri" },
  { key: "STABLE", label: "Stabil" },
];

export function RankingModeToggle({ mode, onChange }: RankingToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Sıralama modu"
      className="ranking-mode-toggle inline-flex max-w-full flex-wrap rounded-[var(--ds-radius-control)] p-px"
      style={{
        border: "1px solid var(--ranking-toggle-track-border)",
        background: "var(--ranking-toggle-track)",
        gap: 0,
      }}
    >
      {MODES.map((m) => {
        const isActive = mode === m.key;
        return (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(m.key)}
            className="relative min-h-[1.625rem] rounded-[calc(var(--ds-radius-control)-1px)] px-2 py-px text-[10px] font-medium tracking-[-0.02em] transition-[color,background-color] duration-200 ease-out sm:min-h-[1.75rem] sm:px-2.25 sm:text-[10.5px] sm:tracking-[-0.019em]"
            style={{
              background: isActive ? "var(--ranking-toggle-active-bg)" : "color-mix(in srgb, transparent 86%, var(--surface-control) 14%)",
              color: isActive ? "var(--accent-blue)" : "var(--text-secondary)",
              boxShadow: isActive ? "inset 0 1px 0 rgba(255,255,255,0.18)" : "none",
            }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Score Badge - Compact pill style
 */
interface ScoreBadgeProps {
  score: number;
  size?: "sm" | "md";
}

export function ScoreBadge({ score, size = "sm" }: ScoreBadgeProps) {
  const getScoreStyle = (s: number) => {
    if (s >= 70) return { bg: "rgba(26, 157, 92, 0.1)", color: "#1a9d5c", border: "rgba(26, 157, 92, 0.15)" };
    if (s >= 50) return { bg: "rgba(37, 112, 200, 0.1)", color: "#2568c4", border: "rgba(37, 112, 200, 0.16)" };
    if (s >= 30) return { bg: "rgba(245, 158, 11, 0.1)", color: "#d97706", border: "rgba(245, 158, 11, 0.15)" };
    return { bg: "rgba(107, 114, 128, 0.08)", color: "#6b7280", border: "rgba(107, 114, 128, 0.12)" };
  };

  const style = getScoreStyle(score);
  const sizeClasses = size === "sm" ? "min-w-[28px] h-5 text-2xs" : "min-w-[32px] h-6 text-xs";

  return (
    <div
      className={`inline-flex items-center justify-center rounded-md font-semibold tabular-nums ${sizeClasses}`}
      style={{
        background: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
      }}
    >
      {score}
    </div>
  );
}

/**
 * Risk Badge - Compact design
 */
interface RiskBadgeProps {
  level: RiskLevel;
}

export function RiskBadge({ level }: RiskBadgeProps) {
  const info = getRiskLevelInfo(level);

  return (
    <span
      className="inline-flex items-center rounded-[5px] px-2 py-[3px] text-[9.5px] font-medium whitespace-nowrap tracking-[-0.015em]"
      style={{
        background: info.bg,
        color: info.color,
        border: `1px solid ${info.border}`,
      }}
    >
      {info.labelShort}
    </span>
  );
}

/**
 * Mini Sparkline Chart - Refined
 */
interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** table: ince çizgi, gömülü görünüm; default: klasik mini grafik */
  variant?: "default" | "table";
}

export function Sparkline({ data, width = 48, height = 18, variant = "default" }: SparklineProps) {
  if (!data || data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-[9px]"
        style={{ width, height, color: "var(--text-muted)" }}
      >
        —
      </div>
    );
  }

  const padY = variant === "table" ? 3.25 : 2;
  const innerH = height - padY * 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const verticalPad = variant === "table" ? 1.1 : 0;

  const points = data.map((value, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = padY + innerH - verticalPad - ((value - min) / range) * (innerH - verticalPad * 2);
    return `${x},${y}`;
  }).join(" ");

  const lastValue = data.at(-1) ?? min;
  const firstValue = data[0] ?? min;
  const isUp = lastValue >= firstValue;
  const color =
    variant === "table"
      ? "var(--accent-blue)"
      : isUp
        ? "var(--sparkline-stroke-up)"
        : "var(--sparkline-stroke-down)";
  const fill =
    variant === "default" && isUp
      ? "var(--sparkline-fill-up)"
      : variant === "default" && !isUp
        ? "var(--sparkline-fill-down)"
        : "none";
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  const strokeW = variant === "table" ? 0.55 : 1.2;
  const showFill = variant === "default";
  const svgClass = variant === "table" ? "sparkline-svg sparkline-svg--table block overflow-visible" : "sparkline-svg block overflow-visible";

  return (
    <svg
      width={width}
      height={height}
      className={svgClass}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      {showFill ? (
        <polygon points={areaPoints} fill={fill} stroke="none" opacity={0.9} />
      ) : null}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={strokeW}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={variant === "table" ? 1 : 0.92}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Metrics Tooltip - Clean design
 */
interface MetricsTooltipProps {
  metrics: FundMetrics;
  scores: NormalizedScores;
  alpha: number;
  riskLevel: RiskLevel;
  children: React.ReactNode;
}

export function MetricsTooltip({ metrics, scores, alpha, riskLevel, children }: MetricsTooltipProps) {
  const [show, setShow] = useState(false);
  const riskInfo = getRiskLevelInfo(riskLevel);

  return (
    <div
      className="relative"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div
          className="absolute z-50 left-0 top-full mt-2 p-3 rounded-lg min-w-[200px]"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: "var(--border-subtle)" }}>
              <span style={{ color: "var(--text-muted)" }}>Risk</span>
              <span
                className="px-1.5 py-0.5 rounded text-2xs font-semibold"
                style={{ background: riskInfo.bg, color: riskInfo.color }}
              >
                {riskInfo.label}
              </span>
            </div>

            <TooltipRow label="Sharpe" value={metrics.sharpeRatio.toFixed(2)} />
            <TooltipRow label="Sortino" value={metrics.sortinoRatio.toFixed(2)} />
            <TooltipRow label="Volatilite" value={`${metrics.volatility.toFixed(1)}%`} />
            <TooltipRow label="Maks. Düşüş" value={`-${metrics.maxDrawdown.toFixed(1)}%`} />
            <TooltipRow
              label="Alpha"
              value={`${alpha >= 0 ? "+" : ""}${alpha.toFixed(1)}%`}
              color={alpha >= 0 ? "var(--success)" : "var(--danger)"}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function TooltipRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="font-medium tabular-nums" style={{ color: color || "var(--text-primary)" }}>
        {value}
      </span>
    </div>
  );
}

/**
 * Alpha Badge - Minimal
 */
interface AlphaBadgeProps {
  alpha: number;
}

export function AlphaBadge({ alpha }: AlphaBadgeProps) {
  const isPositive = alpha >= 0;
  const color = isPositive ? "var(--success)" : "var(--danger)";

  return (
    <span className="text-xs font-medium tabular-nums" style={{ color }}>
      {isPositive ? "+" : ""}{alpha.toFixed(1)}%
    </span>
  );
}

/**
 * Drawdown Display
 */
interface DrawdownProps {
  value: number;
}

export function DrawdownDisplay({ value }: DrawdownProps) {
  const color = value > 15 ? "var(--danger)" : value > 8 ? "#d97706" : "var(--text-muted)";

  return (
    <span className="text-xs tabular-nums" style={{ color }}>
      -{value.toFixed(1)}%
    </span>
  );
}

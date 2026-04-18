"use client";

import { useState, useCallback, useMemo } from "react";
import { Sparkles, RotateCcw, ArrowRight } from "@/components/icons";
import type { RankingMode } from "@/lib/scoring";
import { FUND_THEMES, type FundThemeId } from "@/lib/fund-themes";

export type DiscoveryPreset = {
  risk: "balanced" | "balanced_growth" | "aggressive" | null;
  horizon: "short" | "medium" | "long" | null;
  volatility: "low" | "medium" | "high" | null;
  interestTheme: FundThemeId | null;
};

export type DiscoveryResult = {
  mode: RankingMode;
  hint: string;
  label: string;
  preset: DiscoveryPreset;
};

const RISK_OPTIONS = [
  { id: "balanced", label: "Dengeli" },
  { id: "balanced_growth", label: "Dengeli büyüme" },
  { id: "aggressive", label: "Agresif" },
] as const;

const HORIZON_OPTIONS = [
  { id: "short", label: "Kısa" },
  { id: "medium", label: "Orta" },
  { id: "long", label: "Uzun" },
] as const;

const VOLATILITY_OPTIONS = [
  { id: "low", label: "Düşük" },
  { id: "medium", label: "Orta" },
  { id: "high", label: "Yüksek" },
] as const;

function computeDiscoveryResult(preset: DiscoveryPreset): DiscoveryResult | null {
  const { risk, horizon, volatility } = preset;
  if (!risk && !horizon && !volatility && !preset.interestTheme) return null;

  let mode: RankingMode = "BEST";
  const hints: string[] = [];

  if (volatility === "low" || risk === "balanced") {
    mode = "LOW_RISK";
    hints.push("düşük risk odağı");
  } else if (volatility === "high" || risk === "aggressive") {
    mode = "HIGH_RETURN";
    hints.push("getiri odağı");
  } else if (risk === "balanced_growth" || volatility === "medium") {
    mode = "STABLE";
    hints.push("dengeli dağılım");
  }

  if (horizon === "short") {
    hints.push("kısa vade");
    if (mode === "BEST") mode = "LOW_RISK";
  } else if (horizon === "long") {
    hints.push("uzun vade");
    if (mode === "BEST") mode = "HIGH_RETURN";
  } else if (horizon === "medium") {
    hints.push("orta vade");
  }

  const riskLabel = RISK_OPTIONS.find((o) => o.id === risk)?.label;
  const horizonLabel = HORIZON_OPTIONS.find((o) => o.id === horizon)?.label;
  const volLabel = VOLATILITY_OPTIONS.find((o) => o.id === volatility)?.label;

  const labelParts = [riskLabel, horizonLabel ? `${horizonLabel} vade` : null, volLabel ? `${volLabel} dalgalanma` : null].filter(Boolean);
  if (preset.interestTheme) {
    const themeLabel = FUND_THEMES.find((item) => item.id === preset.interestTheme)?.label;
    if (themeLabel) labelParts.push(`Tema: ${themeLabel}`);
  }

  return {
    mode,
    hint: hints.join(", ") || "genel görünüm",
    label: labelParts.length > 0 ? labelParts.join(" · ") : "Keşif modu",
    preset,
  };
}

type Props = {
  onApply?: (result: DiscoveryResult) => void;
};

export function SmartFundDiscovery({ onApply }: Props) {
  const [preset, setPreset] = useState<DiscoveryPreset>({
    risk: null,
    horizon: null,
    volatility: null,
    interestTheme: null,
  });

  const result = useMemo(() => computeDiscoveryResult(preset), [preset]);
  const hasSelection =
    preset.risk !== null || preset.horizon !== null || preset.volatility !== null || preset.interestTheme !== null;

  const handleReset = useCallback(() => {
    setPreset({ risk: null, horizon: null, volatility: null, interestTheme: null });
  }, []);

  const handleApply = useCallback(() => {
    if (!result) return;
    onApply?.(result);

    const table = document.getElementById("funds-table");
    if (table) {
      table.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [onApply, result]);

  const toggleRisk = (id: DiscoveryPreset["risk"]) => {
    setPreset((prev) => ({ ...prev, risk: prev.risk === id ? null : id }));
  };

  const toggleHorizon = (id: DiscoveryPreset["horizon"]) => {
    setPreset((prev) => ({ ...prev, horizon: prev.horizon === id ? null : id }));
  };

  const toggleVolatility = (id: DiscoveryPreset["volatility"]) => {
    setPreset((prev) => ({ ...prev, volatility: prev.volatility === id ? null : id }));
  };

  const toggleTheme = (id: FundThemeId) => {
    setPreset((prev) => ({ ...prev, interestTheme: prev.interestTheme === id ? null : id }));
  };

  return (
    <section className="mt-4 sm:mt-5" aria-label="Akıllı Fon Keşfi">
      <div
        className="rounded-2xl border px-4 py-3.5 sm:px-5 sm:py-4.5"
        style={{
          borderColor: "color-mix(in srgb, var(--accent-blue) 18%, var(--border-subtle))",
          background: "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))",
        }}
      >
        <div className="flex flex-col gap-3.5 sm:gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Sparkles
                  className="h-3.5 w-3.5 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: "var(--accent-blue)" }}
                />
                <h2
                  className="text-[15px] font-semibold tracking-[-0.03em] sm:text-[17px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  Akıllı Fon Keşfi
                </h2>
              </div>
              <p
                className="mt-1 max-w-[44rem] text-[11.5px] leading-snug sm:text-[13px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Risk, vade ve dalgalanma tercihlerinle bakmaya değer fonları hızlıca öne çıkarır. Yatırım tavsiyesi değildir.
              </p>
            </div>
            {hasSelection && (
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors hover:border-[var(--border-strong)] sm:px-2.5 sm:text-[11px]"
                style={{
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                <RotateCcw className="h-3 w-3" strokeWidth={2} />
                Sıfırla
              </button>
            )}
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 sm:gap-3">
            <PreferenceGroup
              label="Risk yaklaşımın"
              options={RISK_OPTIONS}
              selected={preset.risk}
              onSelect={toggleRisk}
            />
            <PreferenceGroup
              label="Yatırım süren"
              options={HORIZON_OPTIONS}
              selected={preset.horizon}
              onSelect={toggleHorizon}
            />
            <PreferenceGroup
              label="Dalgalanma toleransın"
              options={VOLATILITY_OPTIONS}
              selected={preset.volatility}
              onSelect={toggleVolatility}
            />
            <PreferenceGroup
              label="İlgi alanın (opsiyonel)"
              options={FUND_THEMES.map((item) => ({ id: item.id, label: item.label }))}
              selected={preset.interestTheme}
              onSelect={toggleTheme}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {result ? (
              <p
                className="text-[10px] sm:text-[11px]"
                style={{ color: "var(--text-tertiary)" }}
              >
                <span style={{ color: "var(--text-secondary)" }}>{result.label}</span>
                <span className="mx-1.5">·</span>
                <span>{result.hint}</span>
              </p>
            ) : (
              <p className="text-[10px] sm:text-[11px]" style={{ color: "var(--text-muted)" }}>
                En az bir tercih seç
              </p>
            )}

            <button
              type="button"
              onClick={handleApply}
              disabled={!result}
              className="inline-flex items-center justify-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[11px] font-semibold transition-[color,border-color,background-color,opacity] disabled:opacity-45 sm:px-4 sm:text-[12px]"
              style={{
                borderColor: result ? "var(--accent-blue)" : "var(--border-subtle)",
                color: result ? "var(--accent-blue)" : "var(--text-muted)",
                background: result
                  ? "color-mix(in srgb, var(--accent-blue) 8%, var(--card-bg))"
                  : "transparent",
              }}
            >
              Fonları keşfet
              <ArrowRight className="h-3 w-3" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function PreferenceGroup<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  selected: T | null;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p
        className="text-[9px] font-semibold uppercase tracking-[0.1em] sm:text-[10px]"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className="rounded-full border px-2.5 py-1 text-[10px] font-medium transition-[color,border-color,background-color] sm:px-3 sm:text-[11px]"
              style={{
                borderColor: active
                  ? "var(--segment-active-border)"
                  : "color-mix(in srgb, var(--border-subtle) 88%, transparent)",
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                background: active
                  ? "color-mix(in srgb, var(--accent-blue) 7%, var(--card-bg))"
                  : "color-mix(in srgb, var(--card-bg) 94%, var(--bg-muted))",
              }}
              aria-pressed={active}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default SmartFundDiscovery;

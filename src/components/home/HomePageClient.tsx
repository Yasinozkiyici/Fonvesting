"use client";

import { useCallback, useMemo, useState } from "react";
import {
  BadgeCheck,
  Clock3,
  Coins,
  Network,
  Scale,
  Shield,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { FundLogoMark } from "@/components/tefas/FundLogoMark";
import ScoredFundsTable from "@/components/tefas/ScoredFundsTable";
import type { ScoredFund, ScoredResponse } from "@/types/scored-funds";
import type { RankingMode } from "@/lib/scoring";
import type { FundIntentId } from "@/lib/fund-intents";
import { FUND_THEMES, fundMatchesTheme, type FundThemeId } from "@/lib/fund-themes";
import { fetchNormalizedJson, normalizeScoredResponse } from "@/lib/client-data";

type Props = {
  initialScoresPreview: ScoredResponse | null;
  initialScoresPartial: boolean;
  categories: Array<{ code: string; name: string }>;
  initialMode: RankingMode;
  initialCategory: string;
  initialQuery: string;
  initialIntent: FundIntentId | null;
  initialTheme: FundThemeId | null;
};

type PresetDef = {
  id: string;
  title: string;
  desc: string;
  tags: string[];
  mode: RankingMode;
  category?: string;
  theme?: FundThemeId;
  styleHint: string;
  icon: LucideIcon;
};

const DEFAULT_PRESET: PresetDef = {
  id: "balanced-fallback",
  title: "Dengeli Görünüm",
  desc: "Skor, istikrar ve ölçek dengesini birlikte gösterir.",
  tags: ["daha dengeli", "orta risk", "geniş görünüm"],
  mode: "STABLE",
  styleHint: "daha dengeli yapı",
  icon: Scale,
};

export function HomePageClient({
  initialScoresPreview,
  initialScoresPartial,
  categories,
  initialMode,
  initialCategory,
  initialQuery,
  initialIntent,
  initialTheme,
}: Props) {
  const [activeTab, setActiveTab] = useState<"presets" | "themes" | "categories">(
    initialTheme ? "themes" : initialCategory ? "categories" : "presets"
  );
  const [featuredPresetId, setFeaturedPresetId] = useState<string>("balanced");

  const [discoveryMode, setDiscoveryMode] = useState<RankingMode | null>(null);
  const [discoveryLabel, setDiscoveryLabel] = useState<string | null>(null);
  const [discoverySummary, setDiscoverySummary] = useState<string | null>(null);
  const [discoveryTheme, setDiscoveryTheme] = useState<FundThemeId | null>(initialTheme);
  const [discoveryCategory, setDiscoveryCategory] = useState<string>(initialCategory);
  const [discoveryShortlist, setDiscoveryShortlist] = useState<ScoredFund[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryKind, setDiscoveryKind] = useState<"preset" | "theme" | "category" | null>(
    initialTheme ? "theme" : initialCategory ? "category" : null
  );

  const PRESETS = useMemo(
    (): PresetDef[] => [
      {
        id: "balanced",
        title: "Dengeli Görünüm",
        desc: "Skor, istikrar ve ölçek dengesini birlikte gösterir.",
        tags: ["daha dengeli", "orta risk", "geniş görünüm"],
        mode: "STABLE",
        styleHint: "daha dengeli yapı",
        icon: Scale,
      },
      {
        id: "growth",
        title: "Büyüme Odaklı",
        desc: "Getiri karakteri güçlü fonları öne çeker.",
        tags: ["büyüme odaklı", "yüksek potansiyel"],
        mode: "HIGH_RETURN",
        styleHint: "büyüme odaklı görünüm",
        icon: TrendingUp,
      },
      {
        id: "defensive",
        title: "Daha Savunmacı",
        desc: "Oynaklığı daha düşük profillere yakınlaşır.",
        tags: ["düşük oynaklık", "savunmacı"],
        mode: "LOW_RISK",
        styleHint: "daha sakin profil",
        icon: Shield,
      },
      {
        id: "cash",
        title: "Kısa Vade / Nakit Yönetimi",
        desc: "Kısa vadeli park yaklaşımı için pratik görünüm.",
        tags: ["kısa vade", "nakit yönetimi"],
        mode: "LOW_RISK",
        category: "PPF",
        styleHint: "kısa vade odaklı",
        icon: Clock3,
      },
      {
        id: "gold",
        title: "Altın & Emtia",
        desc: "Emtia etkisi arayanlar için alternatif pencere.",
        tags: ["tema etkisi", "alternatif görünüm"],
        mode: "BEST",
        category: "ALT",
        styleHint: "tema etkisi yüksek",
        icon: Coins,
      },
      {
        id: "participation",
        title: "Katılım",
        desc: "Katılım fonları ekseninde sade keşif.",
        tags: ["katılım", "alternatif"],
        mode: "BEST",
        category: "KTL",
        styleHint: "katılım odaklı",
        icon: BadgeCheck,
      },
      {
        id: "thematic",
        title: "Tematik Büyüme",
        desc: "Tema + büyüme karakterini bir araya getirir.",
        tags: ["tema etkisi", "büyüme"],
        mode: "HIGH_RETURN",
        theme: "technology",
        styleHint: "tema içinde güçlü",
        icon: Network,
      },
    ],
    []
  );

  const baseFunds = initialScoresPreview?.funds ?? [];

  const presetPreviewMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const preset of PRESETS) {
      const themed = preset.theme ? baseFunds.filter((f) => fundMatchesTheme(f, preset.theme ?? null)) : baseFunds;
      const categoryScoped = preset.category ? themed.filter((f) => f.category?.code === preset.category) : themed;
      const approx = Math.max(3, Math.min(24, categoryScoped.length || themed.length || 6));
      map.set(preset.id, `${approx} fon • ${preset.styleHint}`);
    }
    return map;
  }, [PRESETS, baseFunds]);

  const applyDiscovery = useCallback(async (next: {
    mode: RankingMode;
    label: string;
    summary: string;
    kind: "preset" | "theme" | "category";
    theme?: FundThemeId | null;
    category?: string;
  }) => {
    setDiscoveryMode(next.mode);
    setDiscoveryLabel(next.label);
    setDiscoverySummary(next.summary);
    setDiscoveryKind(next.kind);
    setDiscoveryTheme(next.theme ?? null);
    setDiscoveryCategory(next.category ?? "");
    setDiscoveryLoading(true);

    try {
      const payload = await fetchNormalizedJson(
        `/api/funds/scores?mode=${next.mode}`,
        "Fon skor API",
        normalizeScoredResponse
      );
      const themed = next.theme ? payload.funds.filter((fund) => fundMatchesTheme(fund, next.theme ?? null)) : payload.funds;
      const categoryScoped = next.category ? themed.filter((fund) => fund.category?.code === next.category) : themed;
      const prioritized = [...categoryScoped].sort((a, b) => b.finalScore - a.finalScore);
      setDiscoveryShortlist(prioritized.slice(0, 3));
    } catch {
      setDiscoveryShortlist([]);
    } finally {
      setDiscoveryLoading(false);
    }

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", next.mode);
      url.searchParams.delete("intent");
      if (next.theme) url.searchParams.set("theme", next.theme);
      else url.searchParams.delete("theme");
      if (next.category) url.searchParams.set("sector", next.category);
      else url.searchParams.delete("sector");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    }
  }, []);

  const onPresetSelect = useCallback(
    (preset: PresetDef) => {
      setFeaturedPresetId(preset.id);
      applyDiscovery({
        mode: preset.mode,
        label: preset.title,
        summary: preset.desc,
        kind: "preset",
        theme: preset.theme ?? null,
        category: preset.category ?? "",
      });
    },
    [applyDiscovery]
  );

  const onThemeSelect = useCallback(
    (themeId: FundThemeId) => {
      const def = FUND_THEMES.find((item) => item.id === themeId);
      applyDiscovery({
        mode: "HIGH_RETURN",
        label: def?.label ?? "Tema",
        summary: "Seçilen tema içinde öne çıkanlar",
        kind: "theme",
        theme: themeId,
      });
    },
    [applyDiscovery]
  );

  const onCategorySelect = useCallback(
    (categoryCode: string) => {
      const label = categories.find((c) => c.code === categoryCode)?.name ?? categoryCode;
      applyDiscovery({
        mode: "BEST",
        label,
        summary: "Bu kategori için kısa liste",
        kind: "category",
        category: categoryCode,
      });
    },
    [applyDiscovery, categories]
  );

  const handleDiscoveryClear = useCallback(() => {
    setDiscoveryMode(null);
    setDiscoveryLabel(null);
    setDiscoverySummary(null);
    setDiscoveryTheme(null);
    setDiscoveryCategory("");
    setDiscoveryShortlist([]);
    setDiscoveryLoading(false);
    setDiscoveryKind(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("mode");
      url.searchParams.delete("theme");
      url.searchParams.delete("sector");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    }
  }, []);

  const discoveryActive = discoveryKind !== null;
  const effectiveMode = discoveryActive && discoveryMode ? discoveryMode : initialMode;
  const effectiveTheme = discoveryActive ? discoveryTheme : initialTheme;
  const effectiveCategory = discoveryActive ? discoveryCategory : initialCategory;

  const featuredPreset = PRESETS.find((p) => p.id === featuredPresetId) ?? PRESETS[0] ?? DEFAULT_PRESET;
  const secondaryPresets = PRESETS.filter((p) => p.id !== featuredPreset.id);

  const shortlistWithReasons = useMemo(
    () =>
      discoveryShortlist.map((fund) => ({
        fund,
        reason: reasonTag(fund, effectiveMode, discoveryKind),
      })),
    [discoveryShortlist, effectiveMode, discoveryKind]
  );

  return (
    <>
      <section className="mt-4 sm:mt-5" aria-label="Keşif merkezi">
        <div
          className="rounded-2xl border px-3.5 py-3.5 sm:px-5 sm:py-5"
          style={{
            borderColor: "var(--border-subtle)",
            background: "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.03em] sm:text-[17px]" style={{ color: "var(--text-primary)" }}>
                Keşif Merkezi
              </h2>
              <p className="mt-0.5 text-[10.5px] sm:text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
                Hazır görünümlerle daha net bir başlangıç yap, sonra tabloda derinleş.
              </p>
            </div>
            {discoveryActive ? (
              <button
                type="button"
                onClick={handleDiscoveryClear}
                className="rounded-full border px-2.5 py-1 text-[10px] font-medium sm:text-[11px]"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
              >
                Sıfırla
              </button>
            ) : null}
          </div>

          <div className="mt-2.5 inline-flex rounded-full border p-0.5" style={{ borderColor: "var(--border-subtle)", background: "var(--card-bg)" }}>
            {([
              ["presets", "Hazır Görünümler"],
              ["themes", "Temalar"],
              ["categories", "Kategoriler"],
            ] as const).map(([key, label]) => {
              const active = activeTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className="rounded-full px-3 py-1.5 text-[10.5px] font-medium transition-[background-color,color,box-shadow] sm:px-3.5 sm:text-[11.5px]"
                  style={{
                    background: active ? "color-mix(in srgb, var(--accent-blue) 10%, var(--card-bg))" : "transparent",
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,0.22)" : "none",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {activeTab === "presets" ? (
            <div className="mt-3.5 grid grid-cols-1 gap-2.5 xl:grid-cols-[1.35fr_1fr]">
              <button
                type="button"
                onClick={() => onPresetSelect(featuredPreset)}
                className="rounded-xl border px-3.5 py-3.5 text-left"
                style={{
                  borderColor:
                    discoveryActive && discoveryLabel === featuredPreset.title
                      ? "color-mix(in srgb, var(--accent-blue) 34%, var(--border-subtle))"
                      : "color-mix(in srgb, var(--accent-blue) 24%, var(--border-subtle))",
                  background:
                    discoveryActive && discoveryLabel === featuredPreset.title
                      ? "color-mix(in srgb, var(--accent-blue) 9%, var(--card-bg))"
                      : "color-mix(in srgb, var(--accent-blue) 7%, var(--card-bg))",
                  boxShadow:
                    discoveryActive && discoveryLabel === featuredPreset.title
                      ? "inset 0 1px 0 rgba(255,255,255,0.34), 0 2px 6px rgba(15,23,42,0.06)"
                      : "inset 0 1px 0 rgba(255,255,255,0.28), 0 1px 2px rgba(15,23,42,0.04)",
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <featuredPreset.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} style={{ color: "var(--text-secondary)" }} />
                      <p className="text-[13px] font-semibold tracking-[-0.02em] sm:text-[14px]" style={{ color: "var(--text-primary)" }}>
                        {featuredPreset.title}
                      </p>
                    </div>
                    <p className="mt-1.5 text-[10.5px] leading-snug sm:text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      {featuredPreset.desc}
                    </p>
                  </div>
                  <span
                    className="inline-flex shrink-0 rounded-full border px-2 py-[2px] text-[9px] font-medium"
                    style={{ borderColor: "var(--border-subtle)", color: "var(--text-tertiary)" }}
                  >
                    Hazır görünüm
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {featuredPreset.tags.map((tag) => (
                    <span key={tag} className="rounded-full border px-1.75 py-[2px] text-[9px]" style={{ borderColor: "var(--border-subtle)", color: "var(--text-tertiary)" }}>
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2" style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)", background: "color-mix(in srgb, var(--card-bg) 97%, var(--bg-muted))" }}>
                  <div className="min-w-0">
                    <p className="text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                      Ne görürsün
                    </p>
                    <p className="mt-0.5 text-[10px] sm:text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      {presetPreviewMap.get(featuredPreset.id) ?? "yaklaşık 8 fon"}
                    </p>
                  </div>
                  <span className="rounded-full border px-2.5 py-1 text-[10px] font-medium" style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)", background: "var(--card-bg)" }}>
                    Uygula
                  </span>
                </div>
              </button>

              <ul className="grid grid-cols-1 gap-1.75 sm:grid-cols-2 xl:grid-cols-1">
                {secondaryPresets.map((preset) => (
                  <li key={preset.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setFeaturedPresetId(preset.id);
                        onPresetSelect(preset);
                      }}
                      className="w-full rounded-xl border px-3 py-2.5 text-left transition-[border-color,background-color]"
                      style={{
                        borderColor:
                          discoveryActive && discoveryLabel === preset.title
                            ? "var(--segment-active-border)"
                            : "color-mix(in srgb, var(--border-subtle) 86%, transparent)",
                        background:
                          discoveryActive && discoveryLabel === preset.title
                            ? "color-mix(in srgb, var(--accent-blue) 5%, var(--card-bg))"
                            : "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <preset.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} style={{ color: "var(--text-tertiary)" }} />
                        <p className="text-[11.5px] font-semibold" style={{ color: "var(--text-primary)" }}>{preset.title}</p>
                      </div>
                      <p className="mt-0.5 text-[9.75px]" style={{ color: "var(--text-tertiary)" }}>
                        {presetPreviewMap.get(preset.id)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {activeTab === "themes" ? (
            <ul className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
              {FUND_THEMES.map((theme) => {
                const active = discoveryTheme === theme.id && discoveryKind === "theme";
                return (
                  <li key={theme.id}>
                    <button
                      type="button"
                      onClick={() => onThemeSelect(theme.id)}
                      className="w-full rounded-xl border px-2.5 py-2 text-left transition-[border-color,background-color]"
                      style={{
                        borderColor: active ? "var(--segment-active-border)" : "var(--border-subtle)",
                        background: active
                          ? "color-mix(in srgb, var(--accent-blue) 6%, var(--card-bg))"
                          : "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))",
                      }}
                    >
                      <p className="text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>{theme.label}</p>
                      <p className="mt-0.5 text-[9.5px]" style={{ color: "var(--text-tertiary)" }}>{theme.shortHint}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {activeTab === "categories" ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {categories.map((category) => {
                const active = discoveryCategory === category.code && discoveryKind === "category";
                return (
                  <li key={category.code}>
                    <button
                      type="button"
                      onClick={() => onCategorySelect(category.code)}
                      className="rounded-full border px-2.5 py-1 text-[10px] font-medium transition-[border-color,background-color,color] sm:text-[11px]"
                      style={{
                        borderColor: active ? "var(--segment-active-border)" : "var(--border-subtle)",
                        color: active ? "var(--text-primary)" : "var(--text-secondary)",
                        background: active
                          ? "color-mix(in srgb, var(--accent-blue) 7%, var(--card-bg))"
                          : "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))",
                      }}
                    >
                      {category.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </section>

      <div id="funds-table" className="mt-4 sm:mt-5">
        {discoveryActive && (
          <div
            className="mb-3.5 rounded-xl border px-3 py-3.5 sm:px-4 sm:py-4"
            style={{
              borderColor: "color-mix(in srgb, var(--accent-blue) 24%, var(--border-subtle))",
              background: "color-mix(in srgb, var(--accent-blue) 7%, var(--card-bg))",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.24)",
            }}
          >
            <div className="flex items-start justify-between gap-2.5">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold sm:text-[12px]" style={{ color: "var(--text-primary)" }}>
                  {discoveryKind === "theme"
                    ? "Seçilen tema içinde öne çıkanlar"
                    : discoveryKind === "category"
                      ? "Bu kategori için kısa liste"
                      : "Bu görünümde öne çıkan fonlar"}
                </p>
                <p className="mt-0.5 text-[10px] sm:text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  {discoveryLabel ?? "Keşif"} · {discoverySummary ?? "bakmaya değer fonlar"}
                </p>
              </div>
              <span className="rounded-full border px-2 py-[2px] text-[9px] font-medium" style={{ borderColor: "var(--border-subtle)", color: "var(--text-tertiary)" }}>
                Kısa liste
              </span>
            </div>

            <div className="mt-3">
              {discoveryLoading ? (
                <p className="text-[10px] sm:text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  Keşif listesi hazırlanıyor...
                </p>
              ) : shortlistWithReasons.length > 0 ? (
                <ul className="grid grid-cols-1 gap-2.75 lg:grid-cols-3">
                  {shortlistWithReasons.slice(0, 3).map(({ fund, reason }) => (
                    <li
                      key={fund.fundId}
                      className="rounded-xl border px-3 py-3.5"
                      style={{
                        borderColor: "color-mix(in srgb, var(--border-subtle) 84%, transparent)",
                        background: "color-mix(in srgb, var(--card-bg) 97%, var(--bg-muted))",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16)",
                      }}
                    >
                      <div className="flex items-start gap-2.5">
                        <FundLogoMark
                          code={fund.code}
                          logoUrl={fund.logoUrl}
                          wrapperClassName="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border"
                          wrapperStyle={{ borderColor: "var(--border-subtle)", background: "var(--card-bg)" }}
                          imgClassName="h-full w-full object-contain p-1"
                          initialsClassName="text-[10px] font-semibold"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-semibold tracking-[-0.01em]" style={{ color: "var(--text-primary)" }}>
                            {fund.code}
                          </p>
                          <p className="mt-0.75 line-clamp-2 text-[10px] leading-snug" style={{ color: "var(--text-secondary)" }}>
                            {fund.name}
                          </p>
                          <span
                            className="mt-1 inline-flex rounded-full border px-1.5 py-[1px] text-[8.5px] font-medium"
                            style={{ borderColor: "var(--border-subtle)", color: "var(--text-tertiary)" }}
                          >
                            {fund.fundType?.name ?? "Fon"}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-[9.5px]">
                        <div>
                          <p className="uppercase tracking-[0.06em]" style={{ color: "var(--text-muted)" }}>1G</p>
                          <p style={{ color: fund.dailyReturn >= 0 ? "var(--success-muted)" : "var(--danger-muted)" }}>
                            {fund.dailyReturn >= 0 ? "+" : ""}
                            {fund.dailyReturn.toFixed(2)}%
                          </p>
                        </div>
                        <div>
                          <p className="uppercase tracking-[0.06em]" style={{ color: "var(--text-muted)" }}>Yatırımcı</p>
                          <p style={{ color: "var(--text-secondary)" }}>{Math.round(fund.investorCount).toLocaleString("tr-TR")}</p>
                        </div>
                        <div>
                          <p className="uppercase tracking-[0.06em]" style={{ color: "var(--text-muted)" }}>Portföy</p>
                          <p style={{ color: "var(--text-secondary)" }}>₺{Math.round(fund.portfolioSize).toLocaleString("tr-TR")}</p>
                        </div>
                      </div>
                      <span
                        className="mt-2.5 inline-flex rounded-full border px-2 py-[2px] text-[9px] font-medium"
                        style={{
                          borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
                          color: "var(--text-tertiary)",
                          background: "color-mix(in srgb, var(--card-bg) 92%, var(--bg-muted))",
                        }}
                      >
                        {reason}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[10px] sm:text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  Bu profile uygun öne çıkan liste şu an sınırlı görünüyor.
                </p>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => document.getElementById("funds-table-main")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="rounded-full border px-2.75 py-1 text-[10px] font-medium sm:text-[11px]"
                style={{
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-primary)",
                  background: "color-mix(in srgb, var(--card-bg) 98%, var(--bg-muted))",
                }}
              >
                Tüm sonuçları tabloda gör
              </button>
            </div>
          </div>
        )}

        <div id="funds-table-main">
          <ScoredFundsTable
            enableCategoryFilter
            defaultMode="BEST"
            initialData={initialScoresPreview}
            initialDataIsPartial={initialScoresPartial}
            initialCategories={categories}
            initialMode={effectiveMode}
            initialCategory={effectiveCategory}
            initialQuery={initialQuery}
            initialIntent={discoveryActive ? null : initialIntent}
            initialTheme={effectiveTheme}
          />
        </div>
      </div>
    </>
  );
}

function reasonTag(
  fund: ScoredFund,
  mode: RankingMode,
  kind: "preset" | "theme" | "category" | null
): string {
  if (kind === "theme") return fund.finalScore >= 72 ? "tema içinde güçlü görünüm" : "alternatif seçenek";
  if (kind === "category") return fund.investorCount >= 12000 ? "kategori içinde öne çıkıyor" : "alternatif seçenek";
  if (mode === "LOW_RISK") return fund.investorCount > 20000 ? "daha dengeli profil" : "kısa vadede öne çıkıyor";
  if (mode === "HIGH_RETURN") return fund.dailyReturn > 0 ? "büyüme karakteri güçlü" : "getiri odaklı";
  if (mode === "STABLE") return fund.finalScore >= 70 ? "daha dengeli profil" : "alternatif seçenek";
  return fund.finalScore >= 75 ? "güçlü görünüm" : "alternatif seçenek";
}

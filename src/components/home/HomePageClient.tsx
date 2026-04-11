"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, LayoutGrid, Network, Scale, Shield, TrendingUp, type LucideIcon } from "lucide-react";
import ScoredFundsTable from "@/components/tefas/ScoredFundsTable";
import { FeaturedThreeFunds } from "@/components/home/FeaturedThreeFunds";
import { fetchNormalizedJson, normalizeScoredResponse } from "@/lib/client-data";
import type { ScoredFund, ScoredResponse } from "@/types/scored-funds";
import type { RankingMode } from "@/lib/scoring";
import type { FundIntentId } from "@/lib/fund-intents";
import { fundMatchesTheme, type FundThemeId } from "@/lib/fund-themes";
import type { MarketDayTone } from "@/lib/market-tone";
import {
  defaultSecondaryId,
  findSecondaryDef,
  railStepTitle,
  resolveDiscoveryFilters,
  secondaryOptionsForPrimary,
  type DiscoveryPrimaryKind,
} from "@/lib/tefas-discovery-rail";

type Props = {
  initialScoresPreview: ScoredResponse | null;
  initialScoresPartial: boolean;
  categories: Array<{ code: string; name: string }>;
  initialMode: RankingMode;
  initialCategory: string;
  initialQuery: string;
  initialIntent: FundIntentId | null;
  initialTheme: FundThemeId | null;
  marketDayTone?: MarketDayTone | null;
};

type PresetCardId = Exclude<DiscoveryPrimaryKind, "categories">;

type PresetDef = {
  id: PresetCardId;
  title: string;
  short: string;
  micro: string;
  insight: string;
  mode: RankingMode;
  category?: string;
  theme?: FundThemeId;
  icon: LucideIcon;
};

function universeScopeLabel(kind: "preset" | "theme" | "category" | null): string {
  if (kind === "theme") return "Evren: tema";
  if (kind === "category") return "Evren: kategori";
  return "Evren: geniş";
}

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent-blue)_48%,var(--border-subtle))] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card-bg)]";

function primaryToRankingMode(primary: DiscoveryPrimaryKind | null): RankingMode {
  if (primary === "balanced") return "STABLE";
  if (primary === "growth" || primary === "thematic") return "HIGH_RETURN";
  if (primary === "defensive" || primary === "cash") return "LOW_RISK";
  return "BEST";
}

function initialDiscoveryFromUrl(
  initialTheme: FundThemeId | null,
  initialCategory: string,
  categories: Array<{ code: string; name: string }>
): { primary: DiscoveryPrimaryKind | null; secondaryId: string } {
  if (initialTheme) return { primary: "thematic", secondaryId: initialTheme };
  const cat = initialCategory.trim();
  if (cat && categories.some((c) => c.code === cat)) {
    return { primary: "categories", secondaryId: cat };
  }
  return { primary: null, secondaryId: "" };
}

export function HomePageClient({
  initialScoresPreview,
  initialScoresPartial,
  categories,
  initialMode,
  initialCategory,
  initialQuery,
  initialIntent,
  initialTheme,
  marketDayTone = null,
}: Props) {
  const [baselineReset, setBaselineReset] = useState(false);

  const PRESETS = useMemo(
    (): PresetDef[] => [
      {
        id: "balanced",
        title: "Dengeli",
        short: "Dengeli",
        micro: "Dağılım ve riski birlikte dengeleyen bakış",
        insight:
          "Dengeli görünüm, getiri ile oynaklığı birlikte tartan fonları daha görünür hale getirir; ikinci adımda dengeli karakterini netleştirirsin.",
        mode: "STABLE",
        icon: Scale,
      },
      {
        id: "growth",
        title: "Büyüme",
        short: "Büyüme",
        micro: "Uzun vade ve potansiyel odaklı seçimler",
        insight:
          "Büyüme görünümü, uzun vadeli büyüme potansiyeli öne çıkan fonları öne taşır; ikinci adımda büyüme stilini seçersin.",
        mode: "HIGH_RETURN",
        icon: TrendingUp,
      },
      {
        id: "defensive",
        title: "Savunmacı",
        short: "Savunmacı",
        micro: "Oynaklığı daha kontrollü tutan fonlar",
        insight:
          "Savunmacı görünüm, riski daha kontrollü tutan fonları daha görünür hale getirir; ikinci adımda savunmacı profilini seçersin.",
        mode: "LOW_RISK",
        icon: Shield,
      },
      {
        id: "cash",
        title: "Nakit",
        short: "Nakit",
        micro: "Likidite ve kısa vade önceliği",
        insight:
          "Nakit görünümü, likidite ve kısa vadeye yakın fonlarda keşif sunar; ikinci adımda vade/ likidite tonunu seçersin.",
        mode: "LOW_RISK",
        icon: Clock3,
      },
      {
        id: "thematic",
        title: "Tematik",
        short: "Tematik",
        micro: "Tema ve sektör odağında daraltılmış keşif",
        insight:
          "Tematik görünüm, tema ve sektör odağındaki fonları öne çıkarır; ikinci adımda alt temayı seçersin (kategori şeridi değil).",
        mode: "HIGH_RETURN",
        icon: Network,
      },
    ],
    []
  );

  const initUrl = useMemo(
    () => initialDiscoveryFromUrl(initialTheme, initialCategory, categories),
    [categories, initialCategory, initialTheme]
  );

  const [activePrimary, setActivePrimary] = useState<DiscoveryPrimaryKind | null>(() => initUrl.primary);
  const [secondaryId, setSecondaryId] = useState(() => initUrl.secondaryId);
  const [railOpen, setRailOpen] = useState(false);

  const resolvedFilters = useMemo(() => {
    if (!activePrimary || !secondaryId) {
      return { categoryCode: "", themeId: null as FundThemeId | null, secondaryLabel: "" };
    }
    return resolveDiscoveryFilters(activePrimary, secondaryId, categories);
  }, [activePrimary, categories, secondaryId]);

  const effectiveMode: RankingMode =
    activePrimary != null ? primaryToRankingMode(activePrimary) : baselineReset ? "BEST" : initialMode;
  const effectiveTheme: FundThemeId | null =
    activePrimary != null ? resolvedFilters.themeId : baselineReset ? null : initialTheme;
  const effectiveCategory: string = (() => {
    if (baselineReset) return "";
    if (activePrimary) return resolvedFilters.categoryCode;
    return initialCategory || "";
  })();

  const discoveryActive = !baselineReset && activePrimary != null && secondaryId.length > 0;

  useEffect(() => {
    if (baselineReset) return;
    if (!activePrimary) return;
    if (secondaryId) return;
    const def = defaultSecondaryId(activePrimary, categories);
    if (def) setSecondaryId(def);
  }, [activePrimary, baselineReset, categories, secondaryId]);

  useEffect(() => {
    if (!activePrimary || !secondaryId) return;
    if (findSecondaryDef(activePrimary, secondaryId, categories)) return;
    const def = defaultSecondaryId(activePrimary, categories);
    if (def) setSecondaryId(def);
  }, [activePrimary, categories, secondaryId]);

  const activePresetMeta = useMemo(() => {
    if (!activePrimary) return null;
    if (activePrimary === "categories" || activePrimary === "thematic") return null;
    return PRESETS.find((p) => p.id === activePrimary) ?? null;
  }, [PRESETS, activePrimary]);

  const quickStartDisplayLabel = useMemo(() => {
    if (!discoveryActive) return null;
    const sec = resolvedFilters.secondaryLabel;
    if (activePrimary === "categories") {
      return sec || "Kategoriler";
    }
    if (activePrimary === "thematic") {
      return sec ? `Tematik · ${sec}` : "Tematik";
    }
    const pr = activePresetMeta?.title ?? "";
    return sec ? `${pr} · ${sec}` : pr;
  }, [activePresetMeta, activePrimary, discoveryActive, resolvedFilters.secondaryLabel]);

  /** URL — tek yerden senkron */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (baselineReset && !activePrimary) {
      url.searchParams.delete("mode");
      url.searchParams.delete("theme");
      url.searchParams.delete("sector");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
      return;
    }
    url.searchParams.set("mode", effectiveMode);
    url.searchParams.delete("intent");
    if (effectiveTheme) url.searchParams.set("theme", effectiveTheme);
    else url.searchParams.delete("theme");
    if (effectiveCategory) url.searchParams.set("sector", effectiveCategory);
    else url.searchParams.delete("sector");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }, [activePrimary, baselineReset, effectiveCategory, effectiveMode, effectiveTheme]);

  const selectPrimary = useCallback(
    (primary: DiscoveryPrimaryKind) => {
      setBaselineReset(false);
      setActivePrimary(primary);
      const def = defaultSecondaryId(primary, categories);
      setSecondaryId(def);
      setRailOpen(true);
    },
    [categories]
  );

  const onPresetCardClick = useCallback(
    (preset: PresetDef) => {
      if (activePrimary === preset.id) {
        setRailOpen((o) => !o);
        return;
      }
      selectPrimary(preset.id);
    },
    [activePrimary, selectPrimary]
  );

  const onCategoriesCardClick = useCallback(() => {
    if (categories.length === 0) return;
    selectPrimary("categories");
  }, [categories.length, selectPrimary]);

  const onSecondaryChip = useCallback((id: string) => {
    setBaselineReset(false);
    setSecondaryId(id);
  }, []);

  const resetSecondaryToDefault = useCallback(() => {
    if (!activePrimary) return;
    setSecondaryId(defaultSecondaryId(activePrimary, categories));
  }, [activePrimary, categories]);

  const handleDiscoveryClear = useCallback(() => {
    setRailOpen(false);
    setBaselineReset(true);
    setActivePrimary(null);
    setSecondaryId("");
  }, []);

  const presetMatchesDiscovery = useCallback(
    (p: PresetDef) => activePrimary === p.id,
    [activePrimary]
  );

  const categoriesCardActive = activePrimary === "categories";
  const toggleCategoriesRailOnly = useCallback(() => {
    if (categories.length === 0) return;
    if (categoriesCardActive) {
      setRailOpen((o) => !o);
    } else {
      selectPrimary("categories");
    }
  }, [categories.length, categoriesCardActive, selectPrimary]);

  const routeInsight = useMemo(() => {
    if (!activePrimary) return null;
    if (activePrimary === "categories") {
      const def = findSecondaryDef("categories", secondaryId, categories);
      return def ? `“${def.label}” sınıfında keşif.` : "Fon sınıfına göre keşif.";
    }
    if (activePrimary === "thematic") {
      const lab = resolvedFilters.secondaryLabel;
      return lab ? `${lab} temasında odaklanıyorsun.` : "Tema odağında keşif.";
    }
    const hit = PRESETS.find((pr) => pr.id === activePrimary);
    const sec = resolvedFilters.secondaryLabel;
    if (hit && sec) {
      return `“${sec}” ile ${hit.title} çerçevesi.`;
    }
    return hit?.insight ?? null;
  }, [PRESETS, activePrimary, categories, resolvedFilters.secondaryLabel, secondaryId]);

  const editorialContextNote = useMemo(() => {
    if (!discoveryActive) return null;
    return routeInsight;
  }, [discoveryActive, routeInsight]);

  const spotlightPickHint = useMemo(() => {
    if (!discoveryActive) return null;
    const sec = resolvedFilters.secondaryLabel;
    if (!sec) return null;
    if (activePrimary === "categories") return `${sec} kategorisi için`;
    if (activePrimary === "thematic") return `${sec} teması için`;
    const pr = activePresetMeta?.title;
    return pr ? `${sec} · ${pr} görünümü için` : `${sec} için`;
  }, [activePresetMeta?.title, activePrimary, discoveryActive, resolvedFilters.secondaryLabel]);

  const [modeSpotlightPayload, setModeSpotlightPayload] = useState<ScoredResponse | null>(null);

  useEffect(() => {
    if (!discoveryActive) {
      setModeSpotlightPayload(null);
      return;
    }
    const ac = new AbortController();
    fetchNormalizedJson(
      `/api/funds/scores?mode=${effectiveMode}`,
      "Fon API",
      normalizeScoredResponse,
      { signal: ac.signal }
    )
      .then(setModeSpotlightPayload)
      .catch(() => {
        if (!ac.signal.aborted) setModeSpotlightPayload(null);
      });
    return () => ac.abort();
  }, [discoveryActive, effectiveMode]);

  const estimatedUniverseLabel = useMemo(() => {
    const baseFunds = initialScoresPreview?.funds ?? [];
    if (!discoveryActive) return null;
    if (effectiveTheme) {
      const n = baseFunds.filter((f) => fundMatchesTheme(f, effectiveTheme)).length;
      return n > 0 ? `${n.toLocaleString("tr-TR")} fon (tema evreni)` : universeScopeLabel("theme");
    }
    if (effectiveCategory) {
      const n = baseFunds.filter((f) => f.category?.code === effectiveCategory).length;
      return n > 0 ? `${n.toLocaleString("tr-TR")} fon (kategori evreni)` : universeScopeLabel("category");
    }
    return universeScopeLabel(null);
  }, [discoveryActive, effectiveCategory, effectiveTheme, initialScoresPreview?.funds]);

  const referenceUniverseTotal = initialScoresPreview?.total ?? initialScoresPreview?.funds.length ?? null;

  const fundsForSpotlights = discoveryActive ? (modeSpotlightPayload ?? initialScoresPreview) : initialScoresPreview;

  const featuredSpotlights = useMemo(() => {
    const funds: ScoredFund[] = fundsForSpotlights?.funds ?? [];
    let list = funds;
    if (effectiveTheme) list = list.filter((f) => fundMatchesTheme(f, effectiveTheme));
    if (effectiveCategory) list = list.filter((f) => f.category?.code === effectiveCategory);
    const ranked = [...list].sort((a, b) => {
      const na = a.finalScore;
      const nb = b.finalScore;
      const aMissing = na == null || !Number.isFinite(na);
      const bMissing = nb == null || !Number.isFinite(nb);
      if (aMissing && bMissing) return a.code.localeCompare(b.code, "tr");
      if (aMissing) return 1;
      if (bMissing) return -1;
      return nb - na;
    });
    return ranked.slice(0, 3).map((fund, i) => ({
      fund,
      tag: `Bu sıralamada ${i + 1}`,
      micro: fund.fundType?.name?.trim() || fund.category?.name?.trim() || null,
      pickHint: spotlightPickHint,
    }));
  }, [discoveryActive, effectiveCategory, effectiveTheme, fundsForSpotlights, spotlightPickHint]);

  const featuredSectionTitle = useMemo(() => {
    if (!discoveryActive) return "Örnek üçlü — bugünün kesiti";
    const sec = resolvedFilters.secondaryLabel;
    if (sec) return `${sec} odağında öne çıkan 3 fon`;
    return "Öne çıkan 3 fon";
  }, [discoveryActive, resolvedFilters.secondaryLabel]);

  const featuredSectionSubtitle = discoveryActive
    ? "Aynı süzgeç burada da geçerli; karta tıklayınca fon detayına gidersin."
    : "Bir karta dokun: ikinci adım açılır, üç örnek ve tablo birlikte güncellenir.";

  const railChips = useMemo(() => {
    if (!activePrimary) return [];
    return secondaryOptionsForPrimary(activePrimary, categories);
  }, [activePrimary, categories]);

  const showSecondaryRail = Boolean(activePrimary && railOpen && railChips.length > 0);

  return (
    <>
      <section className="discovery-module relative mt-2.5 overflow-hidden rounded-xl border sm:mt-3.5" aria-label="Fon keşfi">
        <div className="discovery-module-accent-rule pointer-events-none absolute bottom-3 left-0 top-3 w-px rounded-full opacity-90" aria-hidden />
        <div className="discovery-module-inner relative px-3 py-2 pl-3.5 sm:px-4 sm:py-3 sm:pl-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-3">
            <div className="min-w-0 flex-1">
              <p
                className="text-[8px] font-semibold uppercase tracking-[0.16em] sm:text-[8.5px]"
                style={{ color: "var(--text-tertiary)" }}
              >
                Fon keşfi
              </p>
              <h2
                className="mt-0.5 text-[1.05rem] font-semibold leading-[1.16] tracking-[-0.036em] sm:text-[1.12rem] sm:leading-[1.18] sm:tracking-[-0.038em]"
                style={{ color: "var(--text-primary)" }}
              >
                Önce rota, sonra incelik
              </h2>
              <p
                className="mt-1 hidden max-w-[34rem] text-[10.5px] font-medium leading-snug sm:block sm:text-[11px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Kartına dokun; altında ikinci adım açılır. Üç örnek ve tablo seçiminle birlikte güncellenir.
                {marketDayTone != null ? (
                  <span className="font-medium tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                    {" "}
                    · {marketDayTone.label}
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-[11px] font-medium leading-snug sm:hidden" style={{ color: "var(--text-secondary)" }}>
                Aşağıdan rota seç; tablo anında daralır.
                {marketDayTone != null ? (
                  <span className="tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                    {" "}
                    · {marketDayTone.label}
                  </span>
                ) : null}
              </p>
            </div>
            <div
              className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 sm:justify-end"
              style={{ color: "var(--text-tertiary)" }}
            >
              <span className="hidden max-w-[15rem] text-[9.5px] font-medium leading-snug sm:inline">
                Keşfi sıfırlayınca tam listeye dönersin.
              </span>
              {discoveryActive ? (
                <button
                  type="button"
                  onClick={handleDiscoveryClear}
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold transition-[opacity,background-color] hover:opacity-90 sm:px-2.5 sm:py-1 sm:text-[9.5px] ${focusRing}`}
                  style={{
                    color: "var(--text-secondary)",
                    borderColor: "color-mix(in srgb, var(--border-subtle) 78%, var(--chart-compare-ref))",
                    background: "color-mix(in srgb, var(--bg-muted) 32%, transparent)",
                  }}
                >
                  Keşfi sıfırla
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-2.5 flex snap-x snap-mandatory gap-2 overflow-x-auto overflow-y-hidden pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:mt-3.5 sm:grid sm:snap-none sm:grid-cols-3 sm:gap-2 sm:overflow-visible sm:pb-0 lg:grid-cols-6 [&::-webkit-scrollbar]:hidden">
            {PRESETS.map((preset) => {
              const Icon = preset.icon;
              const match = presetMatchesDiscovery(preset);
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.insight}
                  aria-pressed={match}
                  data-tone={preset.id}
                  data-active={match ? "true" : "false"}
                  onClick={() => onPresetCardClick(preset)}
                  className={`discovery-preset-card group relative flex min-h-[4.35rem] w-[min(42vw,11.25rem)] shrink-0 snap-start flex-col rounded-[10px] border px-2.5 py-2 text-left transition-[border-color,background-color,box-shadow,transform] duration-200 sm:min-h-[4.85rem] sm:w-auto sm:px-3 sm:py-2.5 ${focusRing} ${
                    match ? "" : "hover:-translate-y-px motion-reduce:hover:translate-y-0"
                  }`}
                >
                  {match ? (
                    <span
                      className="discovery-preset-card__bar pointer-events-none absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full sm:top-3 sm:bottom-3"
                      aria-hidden
                    />
                  ) : null}
                  <div className="flex items-center gap-1.5">
                    <Icon
                      className="h-3 w-3 shrink-0 opacity-[0.66] transition-[opacity,transform] duration-200 group-hover:opacity-[0.9] group-hover:scale-[1.02] motion-reduce:group-hover:scale-100"
                      strokeWidth={1.55}
                      style={{ color: match ? "var(--text-primary)" : "var(--text-tertiary)" }}
                      aria-hidden
                    />
                    <span
                      className={`min-w-0 truncate text-[11.5px] tracking-[-0.02em] sm:text-[12px] ${match ? "font-bold" : "font-semibold"}`}
                      style={{ color: "var(--text-primary)" }}
                    >
                      {preset.short}
                    </span>
                  </div>
                  <span
                    className="mt-1 line-clamp-2 min-h-[2lh] text-[8.5px] font-medium leading-snug sm:text-[9px]"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {preset.micro}
                  </span>
                  <span className="mt-auto pt-1.5 text-[7.5px] font-semibold uppercase tracking-[0.1em] sm:text-[8px]" style={{ color: "var(--text-tertiary)" }}>
                    <span
                      className={match ? "" : "invisible select-none"}
                      style={match ? { color: "var(--text-secondary)" } : undefined}
                      aria-hidden={!match}
                    >
                      Aktif görünüm
                    </span>
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              title="Fon sınıfı ve kategori şeridi"
              aria-pressed={categoriesCardActive}
              aria-expanded={categoriesCardActive && railOpen}
              disabled={categories.length === 0}
              data-tone="categories"
              data-active={categoriesCardActive ? "true" : "false"}
              onClick={toggleCategoriesRailOnly}
              className={`discovery-preset-card group relative flex min-h-[4.35rem] w-[min(42vw,11.25rem)] shrink-0 snap-start flex-col rounded-[10px] border px-2.5 py-2 text-left transition-[border-color,background-color,box-shadow,transform,opacity] duration-200 sm:min-h-[4.85rem] sm:w-auto sm:px-3 sm:py-2.5 ${focusRing} ${
                categoriesCardActive ? "" : "hover:-translate-y-px motion-reduce:hover:translate-y-0"
              } ${categories.length === 0 ? "cursor-not-allowed opacity-50" : ""}`}
            >
              {categoriesCardActive ? (
                <span
                  className="discovery-preset-card__bar pointer-events-none absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full sm:top-3 sm:bottom-3"
                  aria-hidden
                />
              ) : null}
              <div className="flex items-center gap-1.5">
                <LayoutGrid
                  className="h-3 w-3 shrink-0 opacity-[0.66] transition-opacity duration-200 group-hover:opacity-[0.88]"
                  strokeWidth={1.55}
                  style={{ color: categoriesCardActive && railOpen ? "var(--text-primary)" : "var(--text-tertiary)" }}
                  aria-hidden
                />
                <span
                  className="min-w-0 truncate text-[11.5px] font-semibold tracking-[-0.02em] sm:text-[12px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  Kategoriler
                </span>
              </div>
              <span
                className="mt-1 line-clamp-2 min-h-[2lh] text-[8.5px] font-medium leading-snug sm:text-[9px]"
                style={{ color: "var(--text-tertiary)" }}
              >
                Fon sınıfına göre keşif
              </span>
              <span className="mt-auto pt-1.5 text-[7.5px] font-semibold uppercase tracking-[0.1em] sm:text-[8px]" style={{ color: "var(--text-tertiary)" }}>
                <span
                  className={categoriesCardActive && railOpen ? "" : "invisible select-none"}
                  style={categoriesCardActive && railOpen ? { color: "var(--text-secondary)" } : undefined}
                >
                  Şerit açık
                </span>
              </span>
            </button>
          </div>

          {showSecondaryRail ? (
            <div className="discovery-rail mt-2.5 border-t border-dashed pt-2.5 sm:mt-3 sm:pt-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <p className="discovery-rail__title min-w-0 flex-1 text-[9.5px] font-semibold uppercase tracking-[0.1em] sm:text-[10px]">
                  {activePrimary ? railStepTitle(activePrimary) : ""}
                </p>
                {activePrimary && secondaryId !== defaultSecondaryId(activePrimary, categories) ? (
                  <button
                    type="button"
                    onClick={resetSecondaryToDefault}
                    title="İkinci adımı varsayılan seçime döndürür"
                    className={`discovery-rail-reset sm:text-[9px] ${focusRing}`}
                  >
                    Varsayılan seçim
                  </button>
                ) : null}
              </div>
              <div
                className="mt-2.5 flex max-h-none flex-nowrap gap-2 overflow-x-auto overflow-y-hidden pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:max-h-[11.5rem] sm:flex-wrap sm:gap-x-2.5 sm:gap-y-2.5 sm:overflow-y-auto sm:pb-0 [&::-webkit-scrollbar]:hidden"
                role="list"
                aria-label="İkinci adım seçenekleri"
              >
                {railChips.map((chip) => {
                  const picked = secondaryId === chip.id;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      role="listitem"
                      data-active={picked ? "true" : "false"}
                      onClick={() => onSecondaryChip(chip.id)}
                      className={`discovery-chip shrink-0 rounded-full px-3 py-2 text-left text-[10px] font-semibold leading-snug transition-[background-color,color,box-shadow,border-color] duration-200 sm:px-3 sm:py-1.5 sm:text-[10px] ${focusRing}`}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {discoveryActive && editorialContextNote ? (
            <p className="discovery-context-note mt-2.5 max-w-[40rem] rounded-md border-l-[3px] border-solid py-1.5 pl-2.5 pr-2 text-[10px] font-medium leading-snug sm:mt-3 sm:py-2 sm:pl-3 sm:pr-3 sm:text-[10.5px]">
              {editorialContextNote}
            </p>
          ) : null}

          <FeaturedThreeFunds
            embedded
            variant="signature"
            routeActive={discoveryActive}
            items={featuredSpotlights}
            title={featuredSectionTitle}
            subtitle={featuredSectionSubtitle}
          />
        </div>
      </section>

      <div id="funds-table" className="mt-3 sm:mt-3.5">
        <div id="funds-table-main">
          <ScoredFundsTable
            enableCategoryFilter
            defaultMode="BEST"
            initialData={discoveryActive ? null : initialScoresPreview}
            initialDataIsPartial={discoveryActive ? false : initialScoresPartial}
            initialCategories={categories}
            initialMode={effectiveMode}
            initialCategory={effectiveCategory}
            initialQuery={initialQuery}
            initialIntent={discoveryActive || baselineReset ? null : initialIntent}
            initialTheme={effectiveTheme}
            quickStartActive={discoveryActive}
            quickStartLabel={quickStartDisplayLabel}
            quickStartUniverseHint={discoveryActive ? estimatedUniverseLabel : null}
            quickStartOnClear={discoveryActive ? handleDiscoveryClear : undefined}
            referenceUniverseTotal={referenceUniverseTotal}
          />
        </div>
      </div>
    </>
  );
}

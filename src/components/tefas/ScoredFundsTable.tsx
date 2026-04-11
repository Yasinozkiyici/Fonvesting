"use client";

import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  SlidersHorizontal,
  ArrowDownWideNarrow,
} from "lucide-react";
import type { RankingMode } from "@/lib/scoring";
import type { ScoredFund, ScoredResponse } from "@/types/scored-funds";
import { FundRowMobile, FundDataTableRow } from "@/components/ds/FundRow";
import { CompareListEntry } from "@/components/compare/CompareListEntry";
import { MobileBottomSheet } from "@/components/ds/MobileBottomSheet";
import {
  fetchNormalizedJson,
  normalizeCategoryOptions,
  normalizeScoredResponse,
} from "@/lib/client-data";
import { fundMatchesTheme, getFundTheme, type FundThemeId } from "@/lib/fund-themes";
import { fundTypeSortKey } from "@/lib/fund-type-display";
import {
  getFundIntent,
  resolveFundIntentCategory,
  type FundIntentId,
} from "@/lib/fund-intents";

export type { ScoredFund, ScoredResponse };

type SortField = "portfolioSize" | "dailyReturn" | "investorCount" | "lastPrice" | "fundType" | "finalScore";

type SortDir = "asc" | "desc";
const DEFAULT_SORT_FIELD: SortField = "portfolioSize";
const DEFAULT_SORT_DIR: SortDir = "desc";

function rankingModeLabel(mode: RankingMode): string {
  if (mode === "LOW_RISK") return "Düşük Risk";
  if (mode === "HIGH_RETURN") return "Yüksek Getiri";
  if (mode === "STABLE") return "Stabil";
  return "En İyi";
}

interface ScoredFundsTableProps {
  enableCategoryFilter?: boolean;
  defaultMode?: RankingMode;
  initialData?: ScoredResponse | null;
  initialDataIsPartial?: boolean;
  initialCategories?: Array<{ code: string; name: string }>;
  initialMode?: RankingMode;
  initialQuery?: string;
  initialCategory?: string;
  initialIntent?: FundIntentId | null;
  initialTheme?: FundThemeId | null;
  /** Ana sayfa hızlı başlangıç ile tablo üstü bağlam çubuğu */
  quickStartActive?: boolean;
  quickStartLabel?: string | null;
  quickStartUniverseHint?: string | null;
  quickStartOnClear?: () => void;
  /** Varsayılan tam evren (SSR total) — daraltma açıklaması için */
  referenceUniverseTotal?: number | null;
}

export default function ScoredFundsTable({
  enableCategoryFilter = true,
  defaultMode = "BEST",
  initialData = null,
  initialDataIsPartial = false,
  initialCategories = [],
  initialMode = defaultMode,
  initialQuery = "",
  initialCategory = "",
  initialIntent = null,
  initialTheme = null,
  quickStartActive = false,
  quickStartLabel = null,
  quickStartUniverseHint = null,
  quickStartOnClear,
  referenceUniverseTotal = null,
}: ScoredFundsTableProps) {
  const seededInitialData = normalizeScoredResponse(initialData);
  const seededCategories = normalizeCategoryOptions(initialCategories);
  const [rankingMode, setRankingMode] = useState<RankingMode>(initialMode);
  const [modePayloads, setModePayloads] = useState<Partial<Record<RankingMode, ScoredResponse>>>(() =>
    seededInitialData ? { [initialMode]: seededInitialData } : {}
  );
  const modePayloadsRef = useRef(modePayloads);
  modePayloadsRef.current = modePayloads;

  const hasInitialForCurrentMode = Boolean(seededInitialData && rankingMode === initialMode);
  const [loading, setLoading] = useState(!hasInitialForCurrentMode);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>(DEFAULT_SORT_FIELD);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR);
  const [search, setSearch] = useState(initialQuery);
  const [category, setCategory] = useState(enableCategoryFilter ? initialCategory : "");
  const [activeIntent, setActiveIntent] = useState<FundIntentId | null>(initialIntent);
  const [activeTheme, setActiveTheme] = useState<FundThemeId | null>(initialTheme);
  const [categories, setCategories] = useState<Array<{ code: string; name: string }>>(seededCategories);
  const [mobileSheet, setMobileSheet] = useState<null | "filters" | "sort">(null);
  const prevRankingModeRef = useRef<RankingMode | null>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const pageSize = 50;
  const payloadForCurrentMode = modePayloads[rankingMode] ?? null;

  useEffect(() => {
    setRankingMode(initialMode);
    setCategory(enableCategoryFilter ? initialCategory : "");
    setSearch(initialQuery);
    setActiveIntent(initialIntent);
    setActiveTheme(initialTheme);
    setPage(1);
  }, [enableCategoryFilter, initialCategory, initialIntent, initialMode, initialQuery, initialTheme]);

  const prevInitialSnapshotRef = useRef(initialData);
  useEffect(() => {
    if (prevInitialSnapshotRef.current === initialData) return;
    prevInitialSnapshotRef.current = initialData;
    const seeded = normalizeScoredResponse(initialData);
    if (!seeded) return;
    setModePayloads((prev) => ({ ...prev, [initialMode]: seeded }));
  }, [initialData, initialMode]);

  useEffect(() => {
    if (seededCategories.length > 0) return;
    fetchNormalizedJson("/api/categories", "Kategori API", normalizeCategoryOptions)
      .then(setCategories)
      .catch(console.error);
  }, [seededCategories.length]);

  const syncUrlState = useCallback((next: {
    mode?: RankingMode;
    intent?: FundIntentId | null;
    theme?: FundThemeId | null;
    category?: string;
    query?: string;
  }) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const mode = next.mode ?? rankingMode;
    const intent = next.intent !== undefined ? next.intent : activeIntent;
    const theme = next.theme !== undefined ? next.theme : activeTheme;
    const nextCategory = next.category !== undefined ? next.category : category;
    const query = next.query !== undefined ? next.query : search;

    if (mode === "BEST") url.searchParams.delete("mode");
    else url.searchParams.set("mode", mode);

    if (intent) url.searchParams.set("intent", intent);
    else url.searchParams.delete("intent");

    if (theme) url.searchParams.set("theme", theme);
    else url.searchParams.delete("theme");

    if (nextCategory) {
      url.searchParams.set("sector", nextCategory);
    } else {
      url.searchParams.delete("sector");
      url.searchParams.delete("category");
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery) url.searchParams.set("q", trimmedQuery);
    else {
      url.searchParams.delete("q");
      url.searchParams.delete("query");
    }

    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [activeIntent, activeTheme, category, rankingMode, search]);

  useEffect(() => {
    if (!activeIntent) return;
    const intent = getFundIntent(activeIntent);
    if (!intent) return;

    if (rankingMode !== intent.preferredMode) {
      setRankingMode(intent.preferredMode);
    }

    if (enableCategoryFilter) {
      const nextCategory = resolveFundIntentCategory(activeIntent, categories);
      if (category !== nextCategory) {
        setCategory(nextCategory);
      }
    }

    if (sortField !== "finalScore" || sortDir !== "desc") {
      setSortField("finalScore");
      setSortDir("desc");
    }
    setPage(1);
    if (activeTheme) setActiveTheme(null);
    // intent aktifken arama metnini temizleyerek görünümü netleştir.
    if (search) setSearch("");
    syncUrlState({
      intent: activeIntent,
      theme: null,
      mode: intent.preferredMode,
      category: enableCategoryFilter ? resolveFundIntentCategory(activeIntent, categories) : "",
      query: "",
    });
  }, [
    activeIntent,
    activeTheme,
    categories,
    category,
    enableCategoryFilter,
    rankingMode,
    search,
    sortDir,
    sortField,
    syncUrlState,
  ]);

  useEffect(() => {
    const cached = modePayloadsRef.current[rankingMode];
    const needsInitialRefresh =
      initialDataIsPartial && rankingMode === initialMode && cached === seededInitialData;
    if (cached && !needsInitialRefresh) {
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    if (!cached) setLoading(true);
    setError(null);

    fetchNormalizedJson(
      `/api/funds/scores?mode=${rankingMode}`,
      "Fon API",
      normalizeScoredResponse,
      { signal: controller.signal }
    )
      .then((json) => {
        setModePayloads((previous) => ({ ...previous, [rankingMode]: json }));
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Veri yüklenemedi");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [initialDataIsPartial, initialMode, rankingMode, seededInitialData]);

  useEffect(() => {
    if (prevRankingModeRef.current === null) {
      prevRankingModeRef.current = rankingMode;
      return;
    }
    if (prevRankingModeRef.current === rankingMode) return;
    prevRankingModeRef.current = rankingMode;
    if (!activeIntent) {
      setSortField(DEFAULT_SORT_FIELD);
      setSortDir(DEFAULT_SORT_DIR);
    }
    setPage(1);
  }, [activeIntent, rankingMode]);

  const handleRankingModeChange = (next: RankingMode) => {
    setRankingMode(next);
    setActiveIntent(null);
    startTransition(() => {
      setPage(1);
    });
    syncUrlState({ mode: next, intent: null });
  };

  const resetFilters = () => {
    setSearch("");
    setCategory("");
    setActiveIntent(null);
    setActiveTheme(null);
    setPage(1);
    syncUrlState({ query: "", category: "", intent: null, theme: null });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
      return;
    }
    setSortField(field);
    setSortDir("desc");
  };

  const themeScopedFunds = useMemo(() => {
    const funds = payloadForCurrentMode?.funds ?? [];
    if (!activeTheme) return funds;
    return funds.filter((fund) => fundMatchesTheme(fund, activeTheme));
  }, [activeTheme, payloadForCurrentMode]);

  const availableCategories = useMemo(() => {
    if (!enableCategoryFilter) return [];
    if (!activeTheme) return categories;

    const counts = new Map<string, number>();
    for (const fund of themeScopedFunds) {
      const code = fund.category?.code;
      if (!code) continue;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }

    return categories
      .filter((item) => counts.has(item.code))
      .sort((a, b) => {
        const countDiff = (counts.get(b.code) ?? 0) - (counts.get(a.code) ?? 0);
        if (countDiff !== 0) return countDiff;
        return a.name.localeCompare(b.name, "tr");
      });
  }, [activeTheme, categories, enableCategoryFilter, themeScopedFunds]);

  useEffect(() => {
    if (!enableCategoryFilter || !category) return;
    if (categories.length === 0) return;
    if (availableCategories.some((item) => item.code === category)) return;
    setCategory("");
    setPage(1);
    syncUrlState({ category: "" });
  }, [availableCategories, categories.length, category, enableCategoryFilter, syncUrlState]);

  const filteredFunds = useMemo(() => {
    const query = deferredSearch.toLocaleLowerCase("tr-TR");
    const list = themeScopedFunds.filter((fund) => {
      if (enableCategoryFilter && category && fund.category?.code !== category) return false;
      if (!query) return true;
      return fund.code.toLocaleLowerCase("tr-TR").includes(query) || fund.name.toLocaleLowerCase("tr-TR").includes(query);
    });

    return [...list].sort((a, b) => {
      if (sortField === "fundType") {
        const cmp = fundTypeSortKey(a.fundType).localeCompare(fundTypeSortKey(b.fundType), "tr");
        return sortDir === "desc" ? -cmp : cmp;
      }

      let aVal: number;
      let bVal: number;

      switch (sortField) {
        case "portfolioSize":
          aVal = a.portfolioSize;
          bVal = b.portfolioSize;
          break;
        case "dailyReturn":
          aVal = a.dailyReturn;
          bVal = b.dailyReturn;
          break;
        case "investorCount":
          aVal = a.investorCount;
          bVal = b.investorCount;
          break;
        case "lastPrice":
          aVal = a.lastPrice;
          bVal = b.lastPrice;
          break;
        case "finalScore":
        default: {
          const na = a.finalScore;
          const nb = b.finalScore;
          const aMissing = na == null || !Number.isFinite(na);
          const bMissing = nb == null || !Number.isFinite(nb);
          if (sortField === "finalScore") {
            if (aMissing && bMissing) return a.code.localeCompare(b.code, "tr");
            if (aMissing) return 1;
            if (bMissing) return -1;
            const cmp = na - nb;
            return sortDir === "desc" ? -cmp : cmp;
          }
          aVal = na ?? 0;
          bVal = nb ?? 0;
        }
      }

      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
  }, [category, deferredSearch, enableCategoryFilter, sortDir, sortField, themeScopedFunds]);

  const totalPages = Math.max(1, Math.ceil(filteredFunds.length / pageSize));
  const paginatedFunds = filteredFunds.slice((page - 1) * pageSize, page * pageSize);
  const hasFilters = Boolean(search || (enableCategoryFilter && category) || activeIntent || activeTheme);
  const activeIntentDef = useMemo(() => getFundIntent(activeIntent), [activeIntent]);
  const activeThemeDef = useMemo(() => getFundTheme(activeTheme), [activeTheme]);
  const activeCategoryLabel = useMemo(
    () => categories.find((item) => item.code === category)?.name ?? "",
    [categories, category]
  );
  const emptyListMessage = useMemo(() => {
    if (hasFilters) {
      const parts: string[] = [];
      if (search.trim()) parts.push(`arama: "${search.trim()}"`);
      if (enableCategoryFilter && category) parts.push(`kategori: ${activeCategoryLabel || category}`);
      if (activeIntentDef) parts.push(`görünüm: ${activeIntentDef.label}`);
      if (activeThemeDef) parts.push(`tema: ${activeThemeDef.label}`);
      return `Bu kriterlere uygun fon yok. ${parts.length > 0 ? `(${parts.join(" · ")})` : ""} Filtreleri gevşetmeyi veya temizlemeyi deneyin.`;
    }
    return `Bu sıralama modunda (${rankingModeLabel(rankingMode)}) listelenecek fon bulunamadı.`;
  }, [
    activeCategoryLabel,
    activeIntentDef,
    activeThemeDef,
    category,
    enableCategoryFilter,
    hasFilters,
    rankingMode,
    search,
  ]);
  const mobileFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    if (search.trim()) {
      chips.push({
        key: "search",
        label: `Ara: ${search.trim()}`,
        onRemove: () => {
          setSearch("");
          setPage(1);
          syncUrlState({ query: "" });
        },
      });
    }
    if (activeIntentDef) {
      chips.push({
        key: `intent-${activeIntentDef.id}`,
        label: activeIntentDef.label,
        onRemove: () => {
          setActiveIntent(null);
          setPage(1);
          syncUrlState({ intent: null });
        },
      });
    }
    if (activeThemeDef) {
      chips.push({
        key: `theme-${activeThemeDef.id}`,
        label: activeThemeDef.label,
        onRemove: () => {
          setActiveTheme(null);
          setPage(1);
          syncUrlState({ theme: null });
        },
      });
    }
    if (enableCategoryFilter && activeCategoryLabel) {
      chips.push({
        key: `category-${category}`,
        label: activeCategoryLabel,
        onRemove: () => {
          setCategory("");
          setPage(1);
          syncUrlState({ category: "" });
        },
      });
    }
    return chips;
  }, [activeCategoryLabel, activeIntentDef, activeThemeDef, category, enableCategoryFilter, search, syncUrlState]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const activeViewLabel = quickStartActive && quickStartLabel ? quickStartLabel : null;

  const discoveryTableSummary = useMemo(() => {
    if (!quickStartActive || !quickStartLabel) return null;
    const shown = filteredFunds.length;
    const shownStr = shown.toLocaleString("tr-TR");
    const payload = payloadForCurrentMode;
    const registeredTotal = referenceUniverseTotal ?? payload?.total ?? payload?.funds.length ?? shown;
    const regStr = registeredTotal.toLocaleString("tr-TR");
    return { shownStr, contextLabel: quickStartLabel, universeStr: regStr };
  }, [
    filteredFunds.length,
    payloadForCurrentMode,
    quickStartActive,
    quickStartLabel,
    referenceUniverseTotal,
  ]);

  const resultCountCaption = useMemo(() => {
    const shown = filteredFunds.length;
    const shownStr = shown.toLocaleString("tr-TR");
    const payload = payloadForCurrentMode;
    const loadedCount = payload?.funds.length ?? shown;
    const registeredTotal = referenceUniverseTotal ?? payload?.total ?? loadedCount;
    const regStr = registeredTotal.toLocaleString("tr-TR");
    const fullUniverse = shown === registeredTotal;

    if (quickStartActive && quickStartLabel) {
      return null;
    }
    if (hasFilters) {
      const parts: string[] = [];
      if (deferredSearch) parts.push("arama");
      if (enableCategoryFilter && category) parts.push("kategori");
      if (activeIntentDef) parts.push("görünüm");
      if (activeThemeDef) parts.push("tema");
      const hint = parts.length ? parts.join(", ") : "filtre";
      if (fullUniverse) return `${shownStr} fon · ${hint}`;
      return `${shownStr} fon · ${hint} (evren ${regStr})`;
    }
    if (fullUniverse) return `${shownStr} fon · tam evren`;
    if (registeredTotal > shown || loadedCount < registeredTotal) return `${shownStr} / ${regStr} fon`;
    return `${shownStr} fon listeleniyor`;
  }, [
    activeIntentDef,
    activeThemeDef,
    category,
    deferredSearch,
    enableCategoryFilter,
    filteredFunds.length,
    hasFilters,
    payloadForCurrentMode,
    quickStartActive,
    quickStartLabel,
    referenceUniverseTotal,
  ]);

  return (
    <section className="table-container ds-surface-glass scored-funds-table-module overflow-hidden rounded-xl border">
      <header
        className="fund-table-chrome border-b px-3 py-2 sm:px-4 sm:py-2.5 md:py-2.5"
        style={{
          borderColor: "var(--border-subtle)",
          background: "color-mix(in srgb, var(--card-bg) 97%, var(--bg-muted))",
        }}
      >
        <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-x-5 md:gap-y-2 md:gap-3">
          <div className="min-w-0 md:min-w-[12rem] md:flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
              <h2 className="text-[15px] font-semibold leading-tight tracking-[-0.035em] sm:text-base" style={{ color: "var(--text-primary)" }}>
                Fonlar
              </h2>
              {!loading && !error && discoveryTableSummary ? (
                <p
                  className="table-quickstart-caption flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[11px] font-medium leading-snug tabular-nums sm:gap-x-2 sm:text-[11.5px]"
                  aria-live="polite"
                >
                  <span className="shrink-0 tabular-nums">
                    <strong className="font-semibold" style={{ color: "var(--text-primary)" }}>
                      {discoveryTableSummary.shownStr}
                    </strong>
                    <span className="table-quickstart-meta ml-1">sonuç</span>
                  </span>
                  <span className="table-quickstart-meta shrink-0 select-none" aria-hidden>
                    ·
                  </span>
                  <span
                    className="min-w-0 max-w-[min(100%,15rem)] truncate font-semibold sm:max-w-[22rem]"
                    style={{ color: "var(--text-primary)" }}
                    title={discoveryTableSummary.contextLabel}
                  >
                    {discoveryTableSummary.contextLabel}
                  </span>
                  <span className="table-quickstart-meta shrink-0 select-none" aria-hidden>
                    ·
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <strong className="font-semibold" style={{ color: "var(--text-primary)" }}>
                      {discoveryTableSummary.universeStr}
                    </strong>
                    <span className="table-quickstart-meta ml-1">fon evreni</span>
                  </span>
                </p>
              ) : null}
              {!loading && !error && resultCountCaption ? (
                <span
                  className="mt-0.5 block w-full text-[10.5px] font-medium leading-snug tabular-nums sm:mt-0 sm:inline sm:w-auto sm:text-[11px]"
                  style={{ color: "var(--text-tertiary)" }}
                  aria-live="polite"
                >
                  {resultCountCaption}
                </span>
              ) : null}
            </div>
            <div className="flex justify-end pt-1 md:hidden">
              <CompareListEntry />
            </div>
            <p className="sr-only">Tabloda arama, kategori, sıralama ve karşılaştırma kullanılabilir.</p>
            {quickStartActive ? (
              <div className="mt-1.5 hidden flex-wrap items-center gap-1.5 sm:flex">
                {activeViewLabel ? (
                  <span
                    className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] font-medium"
                    style={{ borderColor: "color-mix(in srgb, var(--accent-blue) 22%, var(--border-subtle))", color: "var(--text-secondary)", background: "color-mix(in srgb, var(--accent-blue) 5%, var(--card-bg))" }}
                  >
                    <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                      {activeViewLabel}
                    </span>
                  </span>
                ) : null}
                {quickStartUniverseHint ? (
                  <span
                    className="hidden max-w-[11rem] truncate text-[9px] font-medium sm:inline"
                    style={{ color: "var(--text-tertiary)" }}
                    title={quickStartUniverseHint}
                  >
                    {quickStartUniverseHint}
                  </span>
                ) : null}
                {quickStartOnClear ? (
                  <button
                    type="button"
                    onClick={quickStartOnClear}
                    className="text-[9.5px] font-medium transition-colors hover:text-[var(--text-primary)]"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Sıfırla
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="hidden w-full min-w-0 flex-col gap-2 md:flex md:w-auto md:max-w-[min(100%,22rem)] lg:max-w-[min(100%,26rem)] xl:max-w-[min(100%,30rem)] md:flex-shrink-0 md:flex-row md:flex-wrap md:items-center md:justify-end md:gap-2">
            <div className="relative min-w-0 w-full md:min-w-[10.5rem] md:flex-1 md:max-w-[14rem]">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-[13px] w-[13px] -translate-y-1/2 opacity-[0.78]"
                style={{ color: "var(--text-tertiary)" }}
                strokeWidth={2}
                aria-hidden
              />
              <input
                type="search"
                enterKeyHint="search"
                placeholder="Kod veya unvan ara…"
                value={search}
                onChange={(e) => {
                  const next = e.target.value;
                  setSearch(next);
                  setActiveIntent(null);
                  setPage(1);
                  syncUrlState({ query: next, intent: null });
                }}
                className="research-search w-full"
                autoComplete="off"
                aria-label="Fon ara"
              />
            </div>
            {enableCategoryFilter ? (
              <div className="research-select-wrap min-w-0 w-full md:w-[min(100%,12rem)] md:max-w-[13rem] md:flex-shrink-0">
                <select
                  value={category}
                  onChange={(e) => {
                    const next = e.target.value;
                    setCategory(next);
                    setActiveIntent(null);
                    setPage(1);
                    syncUrlState({ category: next, intent: null });
                  }}
                  className="research-select"
                  aria-label="Kategori filtresi"
                >
                  <option value="">Tüm kategoriler</option>
                  {availableCategories.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="research-select-chevron h-3 w-3" strokeWidth={2} aria-hidden />
              </div>
            ) : null}
            <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
              {hasFilters ? (
                <button type="button" onClick={resetFilters} className="screener-clear-btn shrink-0">
                  <X className="h-3 w-3" strokeWidth={2} aria-hidden />
                  Temizle
                </button>
              ) : null}
              <CompareListEntry />
            </div>
          </div>
        </div>
      </header>

      {/* Mobil: arama + filtre + sırala — header altında sticky; masaüstünde bu blok yok */}
      <div
        className="home-funds-mobile-toolbar md:hidden"
        style={{
          position: "sticky",
          top: "calc(3.375rem + env(safe-area-inset-top, 0px))",
          zIndex: 35,
          borderBottom: "1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent)",
          background: "color-mix(in srgb, var(--card-bg) 88%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <div className="flex min-w-0 items-center gap-2 px-3 py-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 opacity-[0.78]"
              style={{ color: "var(--text-tertiary)" }}
              strokeWidth={2}
              aria-hidden
            />
            <input
              type="search"
              enterKeyHint="search"
              placeholder="Fon ara…"
              value={search}
              onChange={(e) => {
                const next = e.target.value;
                setSearch(next);
                setActiveIntent(null);
                setPage(1);
                syncUrlState({ query: next, intent: null });
              }}
              className="research-search research-search--home-sticky w-full min-w-0"
              autoComplete="off"
              aria-label="Fon ara"
            />
          </div>
          <button
            type="button"
            onClick={() => setMobileSheet("filters")}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.85rem] border transition-[opacity,background-color] active:opacity-90"
            style={{
              borderColor: "var(--border-default)",
              background: "var(--bg-surface)",
              color: "var(--text-primary)",
            }}
            aria-label="Filtreler ve sıralama modu"
          >
            <SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setMobileSheet("sort")}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.85rem] border transition-[opacity,background-color] active:opacity-90"
            style={{
              borderColor: "var(--border-default)",
              background: "var(--bg-surface)",
              color: "var(--text-primary)",
            }}
            aria-label="Listeyi sırala"
          >
            <ArrowDownWideNarrow className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
        </div>
        {mobileFilterChips.length > 0 || (quickStartActive && activeViewLabel) ? (
          <div
            className="flex gap-2 overflow-x-auto px-3 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ borderTop: "1px solid color-mix(in srgb, var(--border-subtle) 55%, transparent)" }}
          >
            {quickStartActive && activeViewLabel ? (
              <div
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5"
                style={{
                  borderColor: "color-mix(in srgb, var(--accent-blue) 22%, var(--border-subtle))",
                  background: "color-mix(in srgb, var(--accent-blue) 5%, var(--card-bg))",
                }}
              >
                <span className="text-[9px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-tertiary)" }}>
                  Rota
                </span>
                <span className="max-w-[11rem] truncate text-[11px] font-semibold" style={{ color: "var(--text-primary)" }} title={activeViewLabel}>
                  {activeViewLabel}
                </span>
                {quickStartOnClear ? (
                  <button
                    type="button"
                    onClick={quickStartOnClear}
                    className="shrink-0 rounded-md px-1 py-0.5 text-[10px] font-semibold"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    Sıfırla
                  </button>
                ) : null}
              </div>
            ) : null}
            {mobileFilterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.onRemove}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium"
                style={{
                  borderColor: "color-mix(in srgb, var(--border-subtle) 86%, transparent)",
                  background: "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))",
                  color: "var(--text-secondary)",
                }}
              >
                <span className="max-w-[10rem] truncate">{chip.label}</span>
                <X className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
              </button>
            ))}
            {hasFilters && mobileFilterChips.length > 0 ? (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex shrink-0 items-center rounded-full border px-2.5 py-1.5 text-[11px] font-semibold"
                style={{
                  borderColor: "var(--border-subtle)",
                  background: "transparent",
                  color: "var(--text-secondary)",
                }}
              >
                Tümünü temizle
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="md:hidden space-y-1.5 px-3 py-1.5">
        {loading ? (
          [...Array(8)].map((_, i) => (
            <div key={i} className="mobile-fund-card mobile-fund-card--scan min-h-[4.5rem] animate-pulse">
              <div className="flex items-start gap-2.5 px-0 py-0">
                <div className="h-9 w-9 shrink-0 rounded-[0.85rem]" style={{ background: "var(--bg-muted)" }} />
                <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                  <div className="h-3 w-16 rounded" style={{ background: "var(--bg-muted)" }} />
                  <div className="h-4 w-full max-w-[14rem] rounded" style={{ background: "var(--bg-muted)" }} />
                  <div className="h-3 w-[72%] rounded" style={{ background: "var(--bg-muted)" }} />
                </div>
              </div>
            </div>
          ))
        ) : error ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            {error}
          </p>
        ) : paginatedFunds.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            {emptyListMessage}
          </p>
        ) : (
          paginatedFunds.map((fund) => <FundRowMobile key={fund.fundId} fund={fund} />)
        )}
      </div>

      <div className="hidden md:block overflow-x-auto tefas-table-touch-scroll">
        <table className="fund-data-table min-w-[736px] w-full text-left">
          <colgroup>
            <col className="fund-col-name" />
            <col className="fund-col-gutter" />
            <col className="fund-col-type" />
            <col className="fund-col-price" />
            <col className="fund-col-1d" />
            <col className="fund-col-inv" />
            <col className="fund-col-aum" />
            <col className="fund-col-compare" />
          </colgroup>
          <thead>
            <tr className="table-header-row">
              <th className="fund-th fund-th-name" scope="col">
                <span className="scored-th-label">Fon</span>
              </th>
              <th className="fund-th fund-th-gutter" scope="col" aria-hidden="true" />
              <th className="fund-th fund-th-type" scope="col">
                <SortableHeader
                  label="Fon türü"
                  field="fundType"
                  align="left"
                  currentField={sortField}
                  currentDir={sortDir}
                  onClick={() => handleSort("fundType")}
                />
              </th>
              <th className="fund-th fund-th-num fund-th-metric table-num" scope="col">
                <SortableHeader
                  label="Son fiyat"
                  field="lastPrice"
                  currentField={sortField}
                  currentDir={sortDir}
                  onClick={() => handleSort("lastPrice")}
                />
              </th>
              <th className="fund-th fund-th-num fund-th-metric table-num" scope="col">
                <SortableHeader label="1G" field="dailyReturn" currentField={sortField} currentDir={sortDir} onClick={() => handleSort("dailyReturn")} />
              </th>
              <th className="fund-th fund-th-num fund-th-metric table-num" scope="col">
                <SortableHeader label="Yatırımcı" field="investorCount" currentField={sortField} currentDir={sortDir} onClick={() => handleSort("investorCount")} />
              </th>
              <th className="fund-th fund-th-num fund-th-metric table-num" scope="col">
                <SortableHeader label="Portföy" field="portfolioSize" currentField={sortField} currentDir={sortDir} onClick={() => handleSort("portfolioSize")} />
              </th>
              <th className="fund-th fund-th-compare table-num" scope="col">
                <span className="sr-only">Karşılaştırma</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(10)].map((_, i) => (
                <tr key={i} className="table-row">
                  <td colSpan={8} className="px-6 py-3">
                    <div className="h-10 rounded-lg animate-pulse" style={{ background: "var(--bg-muted)" }} />
                  </td>
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={8} className="px-6 py-14 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                  {error}
                </td>
              </tr>
            ) : paginatedFunds.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-14 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                  {emptyListMessage}
                </td>
              </tr>
            ) : (
              paginatedFunds.map((fund) => <FundDataTableRow key={fund.fundId} fund={fund} />)
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div
          className="flex items-center justify-between border-t px-4 py-3 sm:px-6"
          style={{ borderColor: "var(--border-subtle)", background: "var(--table-footer-bg)" }}
        >
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            <strong className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
              {filteredFunds.length}
            </strong>{" "}
            fon
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="btn btn-secondary flex h-11 w-11 items-center justify-center rounded-lg p-0 disabled:opacity-40 md:h-9 md:w-9"
            >
              <ChevronLeft className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
            </button>
            <span className="px-2 text-xs font-medium tabular-nums" style={{ color: "var(--text-secondary)" }}>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="btn btn-secondary flex h-11 w-11 items-center justify-center rounded-lg p-0 disabled:opacity-40 md:h-9 md:w-9"
            >
              <ChevronRight className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
            </button>
          </div>
        </div>
      )}

      <MobileBottomSheet
        open={mobileSheet === "filters"}
        title="Filtreler"
        onClose={() => setMobileSheet(null)}
        footer={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                resetFilters();
                setMobileSheet(null);
              }}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-[0.95rem] border px-3 text-sm font-semibold"
              style={{
                borderColor: "var(--border-default)",
                background: "transparent",
                color: "var(--text-secondary)",
              }}
            >
              Temizle
            </button>
            <button
              type="button"
              onClick={() => setMobileSheet(null)}
              className="inline-flex min-h-11 flex-[1.2] items-center justify-center rounded-[0.95rem] px-3 text-sm font-semibold"
              style={{
                background: "var(--text-primary)",
                color: "var(--card-bg)",
              }}
            >
              Uygula
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
              Arama
            </label>
            <input
              type="search"
              enterKeyHint="search"
              placeholder="Kod veya unvan"
              value={search}
              onChange={(e) => {
                const next = e.target.value;
                setSearch(next);
                setActiveIntent(null);
                setPage(1);
                syncUrlState({ query: next, intent: null });
              }}
              className="h-11 w-full rounded-[0.95rem] border px-3 text-sm"
              style={{
                borderColor: "var(--border-default)",
                background: "var(--bg-surface)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
              Sıralama modu
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["BEST", "En İyi"],
                ["LOW_RISK", "Düşük Risk"],
                ["HIGH_RETURN", "Yüksek Getiri"],
                ["STABLE", "Stabil"],
              ] as Array<[RankingMode, string]>).map(([value, label]) => {
                const active = rankingMode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleRankingModeChange(value)}
                    className="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border px-3 text-[12px] font-semibold"
                    style={{
                      borderColor: active ? "var(--segment-active-border)" : "var(--border-default)",
                      background: active ? "color-mix(in srgb, var(--accent-blue) 7%, var(--card-bg))" : "var(--bg-surface)",
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {enableCategoryFilter ? (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                Kategori
              </label>
              <div className="research-select-wrap">
                <select
                  value={category}
                  onChange={(e) => {
                    const next = e.target.value;
                    setCategory(next);
                    setActiveIntent(null);
                    setPage(1);
                    syncUrlState({ category: next, intent: null });
                  }}
                  className="research-select min-h-11 text-sm"
                  aria-label="Kategori filtresi"
                >
                  <option value="">Tüm kategoriler</option>
                  {availableCategories.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="research-select-chevron h-4 w-4" strokeWidth={2} aria-hidden />
              </div>
            </div>
          ) : null}
        </div>
      </MobileBottomSheet>

      <MobileBottomSheet
        open={mobileSheet === "sort"}
        title="Sırala"
        onClose={() => setMobileSheet(null)}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
              Alan
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["portfolioSize", "Portföy"],
                ["finalScore", "Skor"],
                ["dailyReturn", "1G"],
                ["lastPrice", "Son fiyat"],
                ["fundType", "Fon türü"],
                ["investorCount", "Yatırımcı"],
              ] as Array<[SortField, string]>).map(([value, label]) => {
                const active = sortField === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setSortField(value);
                      setPage(1);
                    }}
                    className="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border px-3 text-[12px] font-semibold"
                    style={{
                      borderColor: active ? "var(--segment-active-border)" : "var(--border-default)",
                      background: active ? "color-mix(in srgb, var(--accent-blue) 7%, var(--card-bg))" : "var(--bg-surface)",
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
              Yön
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["desc", "Azalan"],
                ["asc", "Artan"],
              ] as Array<[SortDir, string]>).map(([value, label]) => {
                const active = sortDir === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setSortDir(value);
                      setPage(1);
                    }}
                    className="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border px-3 text-[12px] font-semibold"
                    style={{
                      borderColor: active ? "var(--segment-active-border)" : "var(--border-default)",
                      background: active ? "color-mix(in srgb, var(--accent-blue) 7%, var(--card-bg))" : "var(--bg-surface)",
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </MobileBottomSheet>
    </section>
  );
}

function SortableHeader({
  label,
  field,
  currentField,
  currentDir,
  onClick,
  align = "right",
}: {
  label: string;
  field: SortField;
  currentField: SortField;
  currentDir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
}) {
  const isActive = currentField === field;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`sortable-th-btn table-num text-[10px] font-semibold uppercase tracking-[0.12em] ${align === "left" ? "sortable-th-btn--left" : ""}`}
      style={{ color: isActive ? "var(--accent-blue)" : "var(--text-secondary)" }}
    >
      <span className="sort-th-label">{label}</span>
      <span className="sort-icon-slot" aria-hidden>
        {isActive ? (
          currentDir === "desc" ? (
            <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
          ) : (
            <ChevronUp className="h-3 w-3" strokeWidth={1.75} />
          )
        ) : (
          <ArrowUpDown className="h-2.5 w-2.5 opacity-[0.48]" strokeWidth={1.75} />
        )}
      </span>
    </button>
  );
}

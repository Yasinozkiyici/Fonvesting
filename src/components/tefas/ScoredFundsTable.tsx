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
import { RankingModeToggle } from "./ScoringComponents";
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
        default:
          aVal = a.finalScore;
          bVal = b.finalScore;
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
  const quickCategories = useMemo(() => availableCategories.slice(0, 4), [availableCategories]);
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

  return (
    <section className="table-container ds-surface-glass overflow-hidden rounded-xl border">
      <header
        className="border-b px-4 py-3 sm:px-5 sm:py-3.5"
        style={{
          borderColor: "var(--border-subtle)",
          background: "color-mix(in srgb, var(--card-bg) 97%, var(--bg-muted))",
        }}
      >
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-[-0.03em] sm:text-lg" style={{ color: "var(--text-primary)" }}>
              Fonlar
            </h2>
            <p className="mt-1 text-[12px] leading-snug sm:text-[13px]" style={{ color: "var(--text-secondary)" }}>
              Filtreler ve sıralama URL ile eşlenir; tablo anında güncellenir.
            </p>
            {activeIntentDef || activeThemeDef ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {activeIntentDef ? (
                  <div className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-[10px] font-medium sm:text-[11px]" style={{ borderColor: "var(--segment-active-border)", color: "var(--text-secondary)", background: "color-mix(in srgb, var(--bg-muted) 78%, white)" }}>
                    <span style={{ color: "var(--text-muted)" }}>Görünüm</span>
                    <span style={{ color: "var(--text-primary)" }}>{activeIntentDef.label}</span>
                  </div>
                ) : null}
                {activeThemeDef ? (
                  <div className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-[10px] font-medium sm:text-[11px]" style={{ borderColor: "var(--segment-active-border)", color: "var(--text-secondary)", background: "color-mix(in srgb, var(--bg-muted) 78%, white)" }}>
                    <span style={{ color: "var(--text-muted)" }}>Tema</span>
                    <span style={{ color: "var(--text-primary)" }}>{activeThemeDef.label}</span>
                  </div>
                ) : null}
                <span className="text-[10px] sm:text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {activeIntentDef?.shortHint ?? activeThemeDef?.shortHint} · {rankingModeLabel(rankingMode)}
                  {activeCategoryLabel ? ` · ${activeCategoryLabel}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveIntent(null);
                    setActiveTheme(null);
                    syncUrlState({ intent: null, theme: null });
                  }}
                  className="inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors hover:text-[var(--text-primary)] sm:text-[11px]"
                  style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                >
                  Varsayılana dön
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="hidden md:block screener-bar pt-2.5">
          <div
            className="screener-panel rounded-xl border px-2.5 py-2.5 sm:px-3 sm:py-2.75"
            style={{
              borderColor: "color-mix(in srgb, var(--border-subtle) 88%, transparent)",
              background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
            }}
          >
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-1.75 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
                <div className="relative min-w-0 w-full sm:min-w-[12rem] sm:flex-1 lg:min-w-0 lg:max-w-xl">
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
                {enableCategoryFilter && (
                  <div className="research-select-wrap w-full min-w-0 sm:w-[11rem] lg:w-[12rem]">
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
                )}
                {hasFilters && (
                  <button type="button" onClick={resetFilters} className="screener-clear-btn shrink-0">
                    <X className="h-3 w-3" strokeWidth={2} aria-hidden />
                    Temizle
                  </button>
                )}
                <CompareListEntry />
              </div>

              <div className="screener-divider opacity-70" aria-hidden />

              <div className="flex min-w-0 flex-col justify-center gap-1 lg:rounded-[0.8rem] lg:border lg:px-2.5 lg:py-2 lg:items-end lg:justify-center"
                style={{
                  borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
                  background: "color-mix(in srgb, var(--card-bg) 98%, var(--bg-muted))",
                }}
              >
                <span className="screener-sort-label lg:text-right">Sıralama modu</span>
                <RankingModeToggle mode={rankingMode} onChange={handleRankingModeChange} />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2.5 pt-2 md:hidden">
          <div className="relative w-full">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
              style={{ color: "var(--text-muted)" }}
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
              className="h-10 w-full rounded-[0.9rem] border pl-10 pr-3.5 text-[13px]"
              style={{
                borderColor: "var(--border-default)",
                background: "var(--bg-surface)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={() => {
                  setActiveIntent(null);
                  setPage(1);
                  syncUrlState({ intent: null });
                }}
                className="shrink-0 rounded-full border px-2.75 py-1.25 text-[10.5px] font-medium"
                style={{
                  borderColor: !activeIntent ? "var(--segment-active-border)" : "color-mix(in srgb, var(--border-subtle) 84%, transparent)",
                  background: !activeIntent ? "color-mix(in srgb, var(--accent-blue) 7%, var(--card-bg))" : "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))",
                  color: !activeIntent ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                Tümü
              </button>
              {quickCategories.map((item) => {
                const active = category === item.code;
                return (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => {
                      const next = active ? "" : item.code;
                      setCategory(next);
                      setActiveIntent(null);
                      setPage(1);
                      syncUrlState({ category: next, intent: null });
                    }}
                    className="shrink-0 rounded-full border px-2.75 py-1.25 text-[10.5px] font-medium"
                    style={{
                      borderColor: active ? "var(--segment-active-border)" : "color-mix(in srgb, var(--border-subtle) 84%, transparent)",
                      background: active ? "color-mix(in srgb, var(--accent-blue) 7%, var(--card-bg))" : "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))",
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                  >
                    {item.name}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMobileSheet("filters")}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[0.9rem] border px-3 text-[11.5px] font-semibold"
                style={{
                  borderColor: "var(--border-default)",
                  background: "var(--bg-surface)",
                  color: "var(--text-primary)",
                }}
              >
                <SlidersHorizontal className="h-4 w-4" strokeWidth={2} />
                Filtreler
              </button>
              <button
                type="button"
                onClick={() => setMobileSheet("sort")}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[0.9rem] border px-3 text-[11.5px] font-semibold"
                style={{
                  borderColor: "var(--border-default)",
                  background: "var(--bg-surface)",
                  color: "var(--text-primary)",
                }}
              >
                <ArrowDownWideNarrow className="h-4 w-4" strokeWidth={2} />
                Sırala
              </button>
            </div>
          </div>

          {mobileFilterChips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {mobileFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.onRemove}
                  className="inline-flex items-center gap-1 rounded-full border px-2.25 py-[0.3rem] text-[9.5px] font-medium"
                  style={{
                    borderColor: "color-mix(in srgb, var(--border-subtle) 86%, transparent)",
                    background: "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))",
                    color: "var(--text-secondary)",
                  }}
                >
                  <span className="max-w-[12rem] truncate">{chip.label}</span>
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              ))}
              {hasFilters ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center rounded-full border px-2.25 py-[0.3rem] text-[9.5px] font-medium"
                  style={{
                    borderColor: "var(--border-subtle)",
                    background: "transparent",
                    color: "var(--text-secondary)",
                  }}
                >
                  Temizle
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center justify-between rounded-[0.9rem] border px-2.75 py-2" style={{ borderColor: "var(--border-subtle)", background: "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))" }}>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                Görünüm
              </p>
              <p className="mt-0.5 text-[11.5px] font-medium" style={{ color: "var(--text-primary)" }}>
                {rankingModeLabel(rankingMode)}
              </p>
            </div>
            <CompareListEntry />
          </div>
        </div>
      </header>

      <div className="md:hidden space-y-1.5 px-3 py-1.5">
        {loading ? (
          [...Array(8)].map((_, i) => (
            <div key={i} className="mobile-fund-card max-h-[80px] animate-pulse">
              <div className="flex items-start gap-2">
                <div className="h-8 w-8 shrink-0 rounded-lg" style={{ background: "var(--bg-muted)" }} />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-4 min-w-0 flex-1 rounded" style={{ background: "var(--bg-muted)" }} />
                    <div className="h-4 w-14 shrink-0 rounded" style={{ background: "var(--bg-muted)" }} />
                  </div>
                  <div className="h-3 w-[88%] rounded" style={{ background: "var(--bg-muted)" }} />
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
            Sonuç bulunamadı.
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
                  Sonuç bulunamadı.
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
              className="btn btn-secondary flex h-9 w-9 items-center justify-center rounded-lg p-0 disabled:opacity-40"
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
              className="btn btn-secondary flex h-9 w-9 items-center justify-center rounded-lg p-0 disabled:opacity-40"
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

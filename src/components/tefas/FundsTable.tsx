"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
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
import { FundLogoMark } from "./FundLogoMark";
import {
  fetchNormalizedJson,
  normalizeCategoryOptions,
  normalizeFundListResponse,
  normalizeFundTypeOptions,
} from "@/lib/client-data";
import { fundTypeDisplayLabel } from "@/lib/fund-type-display";
import type { FundListCategoryOption, FundListRow, FundListTypeOption } from "@/lib/services/fund-list.service";
import { FundListRowMobile } from "@/components/ds/FundRow";
import { MobileBottomSheet } from "@/components/ds/MobileBottomSheet";

const SHOW_CLIENT_ERRORS = process.env.NODE_ENV !== "production";

type SortField = "portfolioSize" | "dailyReturn" | "lastPrice" | "investorCount";
type SortDir = "asc" | "desc";

type FundsTableProps = {
  enableCategoryFilter?: boolean;
  initialItems?: FundListRow[];
  initialCategories?: FundListCategoryOption[];
  initialFundTypes?: FundListTypeOption[];
  initialQuery?: string;
  initialCategory?: string;
  initialFundType?: string;
};

export default function FundsTable({
  enableCategoryFilter = true,
  initialItems = [],
  initialCategories = [],
  initialFundTypes = [],
  initialQuery = "",
  initialCategory = "",
  initialFundType = "",
}: FundsTableProps = {}) {
  const [allFunds, setAllFunds] = useState<FundListRow[]>(initialItems);
  const [loading, setLoading] = useState(initialItems.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(initialItems.length);
  const [totalPages, setTotalPages] = useState(Math.max(1, Math.ceil(initialItems.length / 50)));
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>("portfolioSize");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState(initialQuery);
  const [category, setCategory] = useState(enableCategoryFilter ? initialCategory : "");
  const [fundType, setFundType] = useState(initialFundType);
  const [categories, setCategories] = useState<Array<{ code: string; name: string }>>(initialCategories);
  const [fundTypes, setFundTypes] = useState<Array<{ code: number; name: string }>>(initialFundTypes);
  const [mobileSheet, setMobileSheet] = useState<null | "filters" | "sort">(null);
  const deferredSearch = useDeferredValue(search.trim());
  const pageSize = 50;

  useEffect(() => {
    setCategory(enableCategoryFilter ? initialCategory : "");
    setFundType(initialFundType);
    setSearch(initialQuery);
    setPage(1);
  }, [enableCategoryFilter, initialCategory, initialFundType, initialQuery]);

  useEffect(() => {
    const controller = new AbortController();
    const shouldLoadFilters = categories.length === 0 || fundTypes.length === 0;
    if (!shouldLoadFilters) {
      return () => {
        controller.abort();
      };
    }

    Promise.all([
      categories.length === 0
        ? fetchNormalizedJson("/api/categories", "Kategori API", normalizeCategoryOptions, {
            signal: controller.signal,
          })
        : Promise.resolve(categories),
      fundTypes.length === 0
        ? fetchNormalizedJson("/api/fund-types", "Fon türü API", normalizeFundTypeOptions, {
            signal: controller.signal,
          })
        : Promise.resolve(fundTypes),
    ])
      .then(([categoryRows, fundTypeRows]) => {
        if (controller.signal.aborted) return;
        setCategories(categoryRows);
        setFundTypes(fundTypeRows);
      })
      .catch((cause) => {
        if (controller.signal.aborted || !SHOW_CLIENT_ERRORS) return;
        console.error(cause);
      });

    return () => {
      controller.abort();
    };
  }, [categories, fundTypes]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: `${sortField}:${sortDir}`,
    });

    if (deferredSearch) params.set("q", deferredSearch);
    if (enableCategoryFilter && category) params.set("category", category);
    if (fundType) params.set("fundType", fundType);

    fetchNormalizedJson(`/api/funds?${params.toString()}`, "Fon API", normalizeFundListResponse, {
      signal: controller.signal,
    })
      .then((fundsResponse) => {
        if (controller.signal.aborted) return;
        setAllFunds(fundsResponse.items);
        setTotal(fundsResponse.total);
        setTotalPages(Math.max(1, fundsResponse.totalPages));
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        if (SHOW_CLIENT_ERRORS) {
          console.error(cause);
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [page, pageSize, sortField, sortDir, deferredSearch, category, fundType, enableCategoryFilter]);

  const syncUrlState = useCallback((next: {
    query?: string;
    category?: string;
    fundType?: string;
  }) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const query = next.query !== undefined ? next.query : search;
    const nextCategory = next.category !== undefined ? next.category : category;
    const nextFundType = next.fundType !== undefined ? next.fundType : fundType;

    const trimmedQuery = query.trim();
    if (trimmedQuery) url.searchParams.set("q", trimmedQuery);
    else {
      url.searchParams.delete("q");
      url.searchParams.delete("query");
    }

    if (enableCategoryFilter && nextCategory) url.searchParams.set("sector", nextCategory);
    else {
      url.searchParams.delete("sector");
      url.searchParams.delete("category");
    }

    if (nextFundType) url.searchParams.set("index", nextFundType);
    else {
      url.searchParams.delete("index");
      url.searchParams.delete("fundType");
    }

    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [category, enableCategoryFilter, fundType, search]);

  const paginatedFunds = allFunds;

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const resetFilters = () => {
    setSearch("");
    setCategory("");
    setFundType("");
    setPage(1);
    syncUrlState({ query: "", category: "", fundType: "" });
  };

  const hasFilters = Boolean(search || fundType || (enableCategoryFilter && category));

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
      return;
    }
    setSortField(field);
    setSortDir("desc");
  };

  const formatNumber = (n: number) => {
    if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(2)}T`;
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}Mr`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}Mn`;
    return n.toLocaleString("tr-TR");
  };

  const formatPrice = (n: number) =>
    n > 0
      ? `₺${n.toLocaleString("tr-TR", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`
      : "—";

  const formatPort = (n: number) => (n > 0 ? `₺${formatNumber(n)}` : "—");
  const activeCategoryLabel = categories.find((item) => item.code === category)?.name ?? "";
  const activeFundTypeLabel = fundTypes.find((item) => String(item.code) === fundType)?.name ?? "";
  const quickCategories = useMemo(() => categories.slice(0, 4), [categories]);
  const quickTypes = useMemo(() => fundTypes.slice(0, 4), [fundTypes]);

  return (
    <div
      className="overflow-hidden rounded-2xl border shadow-sm"
      style={{ background: "var(--card-bg)", borderColor: "var(--border-default)" }}
    >
      <div className="border-b px-4 py-4 md:px-6 md:py-5" style={{ borderColor: "var(--table-border)" }}>
        <div className="flex flex-col gap-3 md:gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg md:text-2xl font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>
              Yatırım fonları
            </h2>
            <p className="mt-1 text-xs md:text-base" style={{ color: "var(--text-muted)" }}>
              <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
                {total.toLocaleString("tr-TR")}
              </span>{" "}
              fon
              <span className="hidden md:inline"> • Planlı güncelleme ile güncellenir</span>
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:max-w-none sm:items-end">
            <div className="relative hidden w-full sm:w-72 md:block">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
              <input
                type="text"
                placeholder="Fon kodu veya adı..."
                value={search}
                onChange={(e) => {
                  const next = e.target.value;
                  setSearch(next);
                  setPage(1);
                  syncUrlState({ query: next });
                }}
                className="h-11 w-full rounded-xl border pl-10 pr-4 text-sm transition focus:outline-none focus:ring-2"
                style={{
                  borderColor: "var(--border-default)",
                  background: "var(--bg-surface)",
                  color: "var(--text-primary)",
                  boxShadow: "none",
                }}
              />
            </div>

            <div className="hidden w-full flex-wrap gap-2 md:flex">
              <select
                value={fundType}
                onChange={(e) => {
                  setFundType(e.target.value);
                  setPage(1);
                  syncUrlState({ fundType: e.target.value });
                }}
                className="h-10 rounded-xl border px-3 text-sm"
                style={{
                  borderColor: "var(--border-default)",
                  background: "var(--bg-surface)",
                  color: "var(--text-secondary)",
                }}
              >
                <option value="">Tüm fon türleri</option>
                {fundTypes.map((type) => (
                  <option key={type.code} value={String(type.code)}>
                    {type.name}
                  </option>
                ))}
              </select>
              {enableCategoryFilter ? (
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setPage(1);
                    syncUrlState({ category: e.target.value });
                  }}
                  className="h-10 rounded-xl border px-3 text-sm"
                  style={{
                    borderColor: "var(--border-default)",
                    background: "var(--bg-surface)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <option value="">Tüm kategoriler</option>
                  {categories.map((currentCategory) => (
                    <option key={currentCategory.code} value={currentCategory.code}>
                      {currentCategory.name}
                    </option>
                  ))}
                </select>
              ) : null}
              {hasFilters ? (
                <button
                  onClick={resetFilters}
                  className="inline-flex h-10 items-center gap-1 rounded-xl border px-3 text-sm font-medium"
                  style={{
                    borderColor: "var(--border-default)",
                    background: "var(--bg-surface)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                  Temizle
                </button>
              ) : null}
            </div>

            <div className="space-y-3 md:hidden">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
                <input
                  type="search"
                  enterKeyHint="search"
                  placeholder="Fon kodu veya adı"
                  value={search}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSearch(next);
                    setPage(1);
                    syncUrlState({ query: next });
                  }}
                  className="h-11 w-full rounded-[0.95rem] border pl-10 pr-4 text-sm"
                  style={{
                    borderColor: "var(--border-default)",
                    background: "var(--bg-surface)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>

              <div className="flex items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {(enableCategoryFilter ? quickCategories : quickTypes).map((item) => {
                  const value = String(item.code);
                  const active = enableCategoryFilter ? category === value : fundType === value;
                  return (
                    <button
                      key={`${enableCategoryFilter ? "cat" : "type"}-${value}`}
                      type="button"
                      onClick={() => {
                        setPage(1);
                        if (enableCategoryFilter) {
                          const next = active ? "" : value;
                          setCategory(next);
                          syncUrlState({ category: next });
                        } else {
                          const next = active ? "" : value;
                          setFundType(next);
                          syncUrlState({ fundType: next });
                        }
                      }}
                      className="shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium"
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

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMobileSheet("filters")}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[0.95rem] border px-3 text-[12px] font-semibold"
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
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[0.95rem] border px-3 text-[12px] font-semibold"
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

              {hasFilters ? (
                <div className="flex flex-wrap gap-1.5">
                  {search.trim() ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch("");
                        syncUrlState({ query: "" });
                      }}
                      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium"
                      style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)", background: "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))" }}
                    >
                      Ara: {search.trim()}
                      <X className="h-3 w-3" strokeWidth={2} />
                    </button>
                  ) : null}
                  {activeCategoryLabel ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCategory("");
                        syncUrlState({ category: "" });
                      }}
                      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium"
                      style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)", background: "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))" }}
                    >
                      {activeCategoryLabel}
                      <X className="h-3 w-3" strokeWidth={2} />
                    </button>
                  ) : null}
                  {activeFundTypeLabel ? (
                    <button
                      type="button"
                      onClick={() => {
                        setFundType("");
                        syncUrlState({ fundType: "" });
                      }}
                      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium"
                      style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)", background: "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))" }}
                    >
                      {activeFundTypeLabel}
                      <X className="h-3 w-3" strokeWidth={2} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium"
                    style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)", background: "color-mix(in srgb, var(--accent-blue) 6%, var(--card-bg))" }}
                  >
                    Tümünü temizle
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="md:hidden space-y-2 px-3 py-2">
        {loading ? (
          [...Array(8)].map((_, index) => (
            <div
              key={index}
              className="rounded-xl px-2.5 py-2 animate-pulse flex gap-2 items-center"
              style={{ background: "var(--card-bg)", border: "1px solid var(--border-default)" }}
            >
              <div className="h-9 w-9 rounded-lg shrink-0" style={{ background: "var(--bg-hover)" }} />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-2/5 rounded" style={{ background: "var(--bg-hover)" }} />
                <div className="h-3 w-full rounded" style={{ background: "var(--bg-hover)" }} />
              </div>
            </div>
          ))
        ) : error ? (
          <p className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>
            {error}
          </p>
        ) : !paginatedFunds.length ? (
          <p className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>
            Fon bulunamadı
          </p>
        ) : (
          paginatedFunds.map((fund) => <FundListRowMobile key={fund.id} fund={fund} />)
        )}
      </div>

      <div className="hidden md:block overflow-x-auto tefas-table-touch-scroll">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr style={{ background: "var(--table-header-bg)" }}>
              <th className="w-12 px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide md:px-6" style={{ color: "var(--text-muted)" }}>
                #
              </th>
              <th className="min-w-[200px] px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide md:px-6" style={{ color: "var(--text-muted)" }}>
                FON
              </th>
              <th className="w-[120px] px-4 py-4 text-right md:px-6">
                <SortableHeader label="FİYAT" field="lastPrice" currentField={sortField} currentDir={sortDir} onClick={() => handleSort("lastPrice")} />
              </th>
              <th className="w-[110px] px-4 py-4 text-right md:px-6">
                <SortableHeader label="GÜNLÜK %" field="dailyReturn" currentField={sortField} currentDir={sortDir} onClick={() => handleSort("dailyReturn")} />
              </th>
              <th className="hidden w-[140px] px-6 py-4 text-right lg:table-cell">
                <SortableHeader label="PORTFÖY" field="portfolioSize" currentField={sortField} currentDir={sortDir} onClick={() => handleSort("portfolioSize")} />
              </th>
              <th className="hidden w-[120px] px-6 py-4 text-right xl:table-cell">
                <SortableHeader label="YATIRIMCI" field="investorCount" currentField={sortField} currentDir={sortDir} onClick={() => handleSort("investorCount")} />
              </th>
              <th className="hidden w-[140px] px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide xl:table-cell" style={{ color: "var(--text-muted)" }}>
                KATEGORİ
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(8)].map((_, index) => (
                <tr key={index} className="border-b" style={{ borderColor: "var(--table-border)" }}>
                  <td colSpan={7} className="px-6 py-4">
                    <div className="h-4 animate-pulse rounded" style={{ background: "var(--bg-hover)" }} />
                  </td>
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={7} className="px-6 py-6 text-center" style={{ color: "var(--text-muted)" }}>
                  {error}
                </td>
              </tr>
            ) : (
              paginatedFunds.map((fund, index) => (
                <tr
                  key={fund.id}
                  className="stocks-row-accent group border-b transition-colors"
                  style={{ borderColor: "var(--table-border)" }}
                >
                  <td className="px-4 py-4 text-sm font-medium tabular-nums md:px-6" style={{ color: "var(--text-muted)" }}>
                    {(page - 1) * pageSize + index + 1}
                  </td>
                  <td className="px-4 py-4 md:px-6">
                    <FundCell f={fund} />
                  </td>
                  <td className="px-4 py-4 text-right text-sm font-semibold tabular-nums md:px-6" style={{ color: "var(--text-primary)" }}>
                    {formatPrice(fund.lastPrice)}
                  </td>
                  <td className="px-4 py-4 text-right md:px-6">
                    <ChangeBadge value={fund.dailyReturn} hasData={fund.lastPrice > 0} />
                  </td>
                  <td className="hidden px-6 py-4 text-right text-sm tabular-nums lg:table-cell" style={{ color: "var(--text-secondary)" }}>
                    {formatPort(fund.portfolioSize)}
                  </td>
                  <td className="hidden px-6 py-4 text-right text-sm tabular-nums xl:table-cell" style={{ color: "var(--text-secondary)" }}>
                    {fund.investorCount > 0 ? fund.investorCount.toLocaleString("tr-TR") : "—"}
                  </td>
                  <td className="hidden px-6 py-4 xl:table-cell">
                    {fund.category ? (
                      <span className="inline-flex rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
                        {fund.category.name}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && !error && totalPages > 1 ? (
        <div className="border-t px-3 py-3 sm:px-6 sm:py-4" style={{ borderColor: "var(--table-border)", background: "var(--table-header-bg)" }}>
          <div className="flex items-center justify-between">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
                {total.toLocaleString("tr-TR")}
              </span>{" "}
              fon
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="inline-flex h-11 items-center gap-1 rounded-lg border px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  borderColor: "var(--border-default)",
                  background: "var(--bg-surface)",
                  color: "var(--text-secondary)",
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="inline-flex h-11 items-center gap-1 rounded-lg border px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  borderColor: "var(--border-default)",
                  background: "var(--bg-surface)",
                  color: "var(--text-secondary)",
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <MobileBottomSheet
        open={mobileSheet === "filters"}
        title="Filtreler"
        onClose={() => setMobileSheet(null)}
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-[0.9rem] border px-4 text-[12px] font-semibold"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)", background: "var(--bg-surface)" }}
            >
              Temizle
            </button>
            <button
              type="button"
              onClick={() => setMobileSheet(null)}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-[0.9rem] border px-4 text-[12px] font-semibold"
              style={{ borderColor: "var(--segment-active-border)", color: "var(--text-primary)", background: "color-mix(in srgb, var(--accent-blue) 7%, var(--card-bg))" }}
            >
              Uygula
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
              Arama
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => {
                const next = e.target.value;
                setSearch(next);
                setPage(1);
                syncUrlState({ query: next });
              }}
              className="h-11 w-full rounded-[0.95rem] border px-3 text-sm"
              style={{ borderColor: "var(--border-default)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
            />
          </label>

          {enableCategoryFilter ? (
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                Kategori
              </span>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setPage(1);
                  syncUrlState({ category: e.target.value });
                }}
                className="h-11 w-full rounded-[0.95rem] border px-3 text-sm"
                style={{ borderColor: "var(--border-default)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
              >
                <option value="">Tüm kategoriler</option>
                {categories.map((currentCategory) => (
                  <option key={currentCategory.code} value={currentCategory.code}>
                    {currentCategory.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
              Fon türü
            </span>
            <select
              value={fundType}
              onChange={(e) => {
                setFundType(e.target.value);
                setPage(1);
                syncUrlState({ fundType: e.target.value });
              }}
              className="h-11 w-full rounded-[0.95rem] border px-3 text-sm"
              style={{ borderColor: "var(--border-default)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
            >
              <option value="">Tüm fon türleri</option>
              {fundTypes.map((type) => (
                <option key={type.code} value={String(type.code)}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </MobileBottomSheet>

      <MobileBottomSheet
        open={mobileSheet === "sort"}
        title="Sıralama"
        onClose={() => setMobileSheet(null)}
        footer={
          <button
            type="button"
            onClick={() => setMobileSheet(null)}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-[0.9rem] border px-4 text-[12px] font-semibold"
            style={{ borderColor: "var(--segment-active-border)", color: "var(--text-primary)", background: "color-mix(in srgb, var(--accent-blue) 7%, var(--card-bg))" }}
          >
            Tamam
          </button>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
              Alan
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["portfolioSize", "Portföy"],
                ["dailyReturn", "1G"],
                ["lastPrice", "Son fiyat"],
                ["investorCount", "Yatırımcı"],
              ].map(([value, label]) => {
                const active = sortField === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setSortField(value as SortField);
                      setPage(1);
                    }}
                    className="rounded-[0.9rem] border px-3 py-2.5 text-[12px] font-semibold"
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
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
              Yön
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["desc", "Azalan"],
                ["asc", "Artan"],
              ].map(([value, label]) => {
                const active = sortDir === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setSortDir(value as SortDir);
                      setPage(1);
                    }}
                    className="rounded-[0.9rem] border px-3 py-2.5 text-[12px] font-semibold"
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
    </div>
  );
}

function SortableHeader({
  label,
  field,
  currentField,
  currentDir,
  onClick,
}: {
  label: string;
  field: SortField;
  currentField: SortField;
  currentDir: SortDir;
  onClick: () => void;
}) {
  const isActive = currentField === field;
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide transition"
      style={{ color: isActive ? "var(--accent)" : "var(--text-muted)" }}
    >
      {label}
      {isActive ? (
        currentDir === "desc" ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-60" />
      )}
    </button>
  );
}

function FundCell({ f }: { f: FundListRow }) {
  return (
    <div className="flex items-center gap-3">
      <FundLogoMark
        code={f.code}
        logoUrl={f.logoUrl}
        wrapperClassName="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border text-xs font-semibold"
        wrapperStyle={{
          borderColor: "var(--border-default)",
          background: "var(--bg-hover)",
          color: "var(--text-secondary)",
        }}
        imgClassName="h-full w-full object-contain p-0.5"
        initialsClassName="text-xs font-semibold"
      />
      <div className="min-w-0">
        <p className="font-semibold text-[15px]" style={{ color: "var(--text-primary)" }}>
          {f.code}
        </p>
        <p className="truncate text-sm" style={{ color: "var(--text-secondary)" }}>
          {f.name}
        </p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          {fundTypeDisplayLabel(f.fundType)}
        </p>
      </div>
    </div>
  );
}

function ChangeBadge({ value, hasData }: { value: number; hasData: boolean }) {
  if (!hasData) {
    return <span style={{ color: "var(--text-muted)" }}>—</span>;
  }

  const positive = value >= 0;
  return (
    <span
      className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums"
      style={{
        background: positive ? "rgba(26,157,92,0.1)" : "rgba(225,29,72,0.1)",
        color: positive ? "var(--success)" : "var(--danger)",
      }}
    >
      {positive ? "+" : ""}
      {value.toFixed(2).replace(".", ",")}%
    </span>
  );
}

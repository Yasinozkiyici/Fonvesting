"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import type { RankingMode } from "@/lib/scoring";
import { RankingModeToggle } from "./ScoringComponents";
import type { ScoredFund, ScoredResponse } from "@/types/scored-funds";
import { FundRowMobile, FundDataTableRow } from "@/components/ds/FundRow";
import { fundTypeSortKey } from "@/lib/fund-type-display";

export type { ScoredFund, ScoredResponse };

type SortField = "portfolioSize" | "dailyReturn" | "investorCount" | "lastPrice" | "fundType" | "finalScore";

type SortDir = "asc" | "desc";

interface ScoredFundsTableProps {
  enableCategoryFilter?: boolean;
  defaultMode?: RankingMode;
  initialData?: ScoredResponse | null;
  initialCategories?: Array<{ code: string; name: string }>;
}

export default function ScoredFundsTable({
  enableCategoryFilter = true,
  defaultMode = "BEST",
  initialData = null,
  initialCategories = [],
}: ScoredFundsTableProps) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<ScoredResponse | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>("portfolioSize");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [rankingMode, setRankingMode] = useState<RankingMode>(defaultMode);
  const [categories, setCategories] = useState<Array<{ code: string; name: string }>>(initialCategories);
  const usedInitialDataRef = useRef(Boolean(initialData));
  const pageSize = 50;

  useEffect(() => {
    const sectorParam = searchParams?.get("sector") ?? searchParams?.get("category") ?? "";
    const qParam = searchParams?.get("q") ?? "";
    setCategory(enableCategoryFilter ? sectorParam : "");
    setSearch(qParam);
    setPage(1);
  }, [searchParams, enableCategoryFilter]);

  useEffect(() => {
    if (initialCategories.length > 0) return;
    fetch("/api/categories")
      .then((r) => r.json())
      .then((rows: Array<{ code: string; name: string }>) =>
        setCategories(rows.map((x) => ({ code: x.code, name: x.name })))
      )
      .catch(console.error);
  }, [initialCategories.length]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      mode: rankingMode,
    });

    try {
      const res = await fetch(`/api/funds/scores?${params}`);
      const jsonUnknown: unknown = await res.json();
      if (!res.ok) {
        const errBody = jsonUnknown as { error?: string; message?: string };
        const detail =
          typeof errBody.message === "string" && errBody.message.trim()
            ? errBody.message.trim()
            : typeof errBody.error === "string"
              ? errBody.error
              : `HTTP ${res.status}`;
        throw new Error(detail);
      }
      const json = jsonUnknown as ScoredResponse;
      if (!json || !("funds" in json) || !Array.isArray(json.funds)) {
        throw new Error("Fon API beklenen formatta değil");
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Veri yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [rankingMode]);

  useEffect(() => {
    if (usedInitialDataRef.current && rankingMode === defaultMode) {
      usedInitialDataRef.current = false;
      return;
    }
    fetchData();
  }, [defaultMode, fetchData, rankingMode]);

  const resetFilters = () => {
    setSearch("");
    setCategory("");
    setPage(1);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
      return;
    }
    setSortField(field);
    setSortDir("desc");
  };

  const filteredFunds = useMemo(() => {
    const list = (data?.funds ?? []).filter((fund) => {
      if (enableCategoryFilter && category && fund.category?.code !== category) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return fund.code.toLowerCase().includes(q) || fund.name.toLowerCase().includes(q);
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
  }, [data?.funds, enableCategoryFilter, category, search, sortField, sortDir]);

  const totalPages = Math.ceil(filteredFunds.length / pageSize);
  const paginatedFunds = filteredFunds.slice((page - 1) * pageSize, page * pageSize);
  const hasFilters = Boolean(search || (enableCategoryFilter && category));

  return (
    <section className="table-container ds-surface-glass overflow-hidden rounded-xl border">
      <header className="border-b px-4 py-3 sm:px-5 sm:py-4" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-[-0.03em] sm:text-lg" style={{ color: "var(--text-primary)" }}>
              Fonlar
            </h2>
            <p className="mt-1 text-[12px] leading-snug sm:text-[13px]" style={{ color: "var(--text-secondary)" }}>
              Tüm veriler önbellekten; sıralama ve filtre anında uygulanır.
            </p>
          </div>
        </div>

        <div className="screener-bar">
          <div className="screener-panel">
            <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between lg:gap-5">
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="relative min-w-0 w-full sm:min-w-[12rem] sm:flex-1 lg:min-w-0 lg:max-w-xl">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-[14px] w-[14px] -translate-y-1/2 opacity-[0.78]"
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
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    className="research-search w-full"
                    autoComplete="off"
                    aria-label="Fon ara"
                  />
                </div>
                {enableCategoryFilter && (
                  <div className="research-select-wrap w-full min-w-0 sm:w-[11.5rem] lg:w-[12.5rem]">
                    <select
                      value={category}
                      onChange={(e) => {
                        setCategory(e.target.value);
                        setPage(1);
                      }}
                      className="research-select"
                      aria-label="Kategori filtresi"
                    >
                      <option value="">Tüm kategoriler</option>
                      {categories.map((item) => (
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
              </div>

              <div className="screener-divider" aria-hidden />

              <div className="flex min-w-0 flex-col justify-center gap-1.5 lg:items-end lg:justify-center">
                <span className="screener-sort-label lg:text-right">Sıralama modu</span>
                <RankingModeToggle mode={rankingMode} onChange={setRankingMode} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex gap-2 md:hidden">
          <div className="research-select-wrap min-w-0 flex-1">
            <select
              value={sortField}
              onChange={(e) => {
                setSortField(e.target.value as SortField);
                setPage(1);
              }}
              className="research-select min-h-[2.75rem] text-xs font-semibold"
              aria-label="Sıralama alanı"
            >
              <option value="portfolioSize">Portföy</option>
              <option value="finalScore">Skor</option>
              <option value="dailyReturn">1G</option>
              <option value="lastPrice">Son fiyat</option>
              <option value="fundType">Fon türü</option>
              <option value="investorCount">Yatırımcı</option>
            </select>
            <ChevronDown className="research-select-chevron h-4 w-4" strokeWidth={2} aria-hidden />
          </div>
          <div className="research-select-wrap w-[118px] shrink-0">
            <select
              value={sortDir}
              onChange={(e) => {
                setSortDir(e.target.value as SortDir);
                setPage(1);
              }}
              className="research-select h-11 px-2 text-xs font-semibold"
              aria-label="Sıralama yönü"
            >
              <option value="desc">Azalan</option>
              <option value="asc">Artan</option>
            </select>
            <ChevronDown className="research-select-chevron h-4 w-4" strokeWidth={2} aria-hidden />
          </div>
        </div>
      </header>

      <div className="md:hidden space-y-2 px-3 py-2">
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
        <table className="fund-data-table min-w-[780px] w-full text-left">
          <colgroup>
            <col className="fund-col-name" />
            <col className="fund-col-gutter" />
            <col className="fund-col-type" />
            <col className="fund-col-price" />
            <col className="fund-col-1d" />
            <col className="fund-col-inv" />
            <col className="fund-col-aum" />
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
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(10)].map((_, i) => (
                <tr key={i} className="table-row">
                  <td colSpan={7} className="px-6 py-3">
                    <div className="h-10 rounded-lg animate-pulse" style={{ background: "var(--bg-muted)" }} />
                  </td>
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={7} className="px-6 py-14 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                  {error}
                </td>
              </tr>
            ) : paginatedFunds.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-14 text-center text-sm" style={{ color: "var(--text-muted)" }}>
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

"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { fundDetailHref } from "@/lib/fund-routes";
import {
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import type { RankingMode, NormalizedScores, FundMetrics, RiskLevel } from "@/lib/scoring";
import { RankingModeToggle, Sparkline } from "./ScoringComponents";
import { FundLogoMark } from "./FundLogoMark";

interface ScoredFund {
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  category: { code: string; name: string } | null;
  fundType: { code: number; name: string } | null;
  finalScore: number;
  riskLevel: RiskLevel;
  scores: NormalizedScores;
  metrics: FundMetrics;
  alpha: number;
  sparkline: number[];
}

export interface ScoredResponse {
  mode: RankingMode;
  total: number;
  funds: ScoredFund[];
}

type SortField = "finalScore" | "portfolioSize" | "dailyReturn" | "investorCount";
type SortDir = "asc" | "desc";

interface ScoredFundsTableProps {
  enableCategoryFilter?: boolean;
  defaultMode?: RankingMode;
  initialData?: ScoredResponse | null;
  initialCategories?: Array<{ code: string; name: string }>;
}

const CATEGORY_SHORT: Record<string, string> = {
  SRB: "Serbest",
  PPF: "Para Piyasası",
  ALT: "Altın & Emtia",
  BRC: "Borçlanma",
  HSF: "Hisse",
  KTL: "Katılım",
  FSP: "Fon Sepeti",
  DGS: "Değişken",
  KRM: "Karma",
  DGR: "Diğer",
};

/** 7G sparkline serisinin ilk–son noktasına göre yüzde değişim (7G hücresinde ince özet). */
function sparklinePeriodReturnPct(data: number[] | null | undefined): number | null {
  if (!data || data.length < 2) return null;
  const first = data.at(0);
  const last = data.at(-1);
  if (first === undefined || last === undefined) return null;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return ((last - first) / first) * 100;
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
    return (data?.funds ?? [])
      .filter((fund) => {
        if (enableCategoryFilter && category && fund.category?.code !== category) return false;
        if (!search) return true;
        const q = search.toLowerCase();
        return fund.code.toLowerCase().includes(q) || fund.name.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        let aVal = a.finalScore;
        let bVal = b.finalScore;

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
    <section
      className="table-container overflow-hidden"
      style={{
        background: "var(--card-bg)",
      }}
    >
      <header className="border-b px-4 py-3.5 sm:px-5 sm:py-4" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-[-0.034em] sm:text-xl" style={{ color: "var(--text-primary)" }}>
              Fon sıralaması
            </h2>
            <p className="mt-1 text-[13px] leading-[1.45] tracking-[-0.01em] sm:text-sm sm:leading-snug" style={{ color: "var(--text-secondary)" }}>
              Getiri, risk ve büyüklük — filtre ve sıralama anında uygulanır.
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
                    placeholder="Fon kodu veya unvan ara…"
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
              <option value="portfolioSize">AUM (büyüklük)</option>
              <option value="finalScore">Seçili mod skoru</option>
              <option value="dailyReturn">1G</option>
              <option value="investorCount">Yatırımcı</option>
            </select>
            <ChevronDown className="research-select-chevron h-4 w-4" strokeWidth={2.25} aria-hidden />
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
            <ChevronDown className="research-select-chevron h-4 w-4" strokeWidth={2.25} aria-hidden />
          </div>
        </div>
      </header>

      <div className="md:hidden px-3 py-3 space-y-2.5">
        {loading ? (
          [...Array(6)].map((_, i) => (
            <div
              key={i}
              className="rounded-[20px] border px-3 py-3 animate-pulse"
              style={{ background: "var(--surface-glass)", borderColor: "var(--card-border)" }}
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl" style={{ background: "var(--bg-muted)" }} />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-20 rounded" style={{ background: "var(--bg-muted)" }} />
                  <div className="h-3 w-full rounded" style={{ background: "var(--bg-muted)" }} />
                </div>
              </div>
              <div className="h-12 rounded-xl" style={{ background: "var(--bg-muted)" }} />
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
          paginatedFunds.map((fund, index) => (
            <MobileFundCard key={fund.fundId} fund={fund} rank={(page - 1) * pageSize + index + 1} />
          ))
        )}
      </div>

      <div className="hidden md:block overflow-x-auto tefas-table-touch-scroll">
        <table className="tefas-scored-table w-full min-w-[1000px] text-left">
          <colgroup>
            <col className="scored-col-rank" />
            <col className="scored-col-fund" />
            <col className="scored-col-cat" />
            <col className="scored-col-risk" />
            <col className="scored-col-ret" />
            <col className="scored-col-inv" />
            <col className="scored-col-aum" />
            <col className="scored-col-spark" />
          </colgroup>
          <thead>
            <tr className="table-header-row">
              <th className="scored-h-rank" scope="col">
                <span className="scored-th-label table-num">#</span>
              </th>
              <th className="scored-h-fund" scope="col">
                <span className="scored-th-label">Fon</span>
              </th>
              <th className="scored-h-cat" scope="col">
                <span className="scored-th-label">Kategori</span>
              </th>
              <th className="scored-h-risk" scope="col">
                <span className="scored-th-label">Risk</span>
              </th>
              <th className="scored-h-num table-num" scope="col">
                <SortableHeader label="1G" field="dailyReturn" currentField={sortField} currentDir={sortDir} onClick={() => handleSort("dailyReturn")} />
              </th>
              <th className="scored-h-inv table-num" scope="col">
                <SortableHeader label="Yatırımcı" field="investorCount" currentField={sortField} currentDir={sortDir} onClick={() => handleSort("investorCount")} />
              </th>
              <th className="scored-h-aum table-num" scope="col">
                <SortableHeader
                  label="Portföy büyüklüğü"
                  field="portfolioSize"
                  currentField={sortField}
                  currentDir={sortDir}
                  onClick={() => handleSort("portfolioSize")}
                />
              </th>
              <th className="scored-h-spark" scope="col">
                <span className="scored-th-label">7G</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(10)].map((_, i) => (
                <tr key={i} className="table-row">
                  <td colSpan={8} className="px-6 py-3">
                    <div className="h-12 rounded-xl animate-pulse" style={{ background: "var(--bg-muted)" }} />
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
              paginatedFunds.map((fund, index) => {
                const rank = (page - 1) * pageSize + index + 1;
                const categoryName = fund.category?.code ? (CATEGORY_SHORT[fund.category.code] ?? fund.category.name) : "—";
                const categoryTitle = fund.category?.name ?? categoryName;
                const subtitle = (fund.shortName && fund.shortName !== fund.code ? fund.shortName : fund.name).trim();
                const spark7d = sparklinePeriodReturnPct(fund.sparkline);
                return (
                  <tr key={fund.fundId} className="table-row stocks-row-accent group">
                    <td className="scored-d-rank">
                      <span className="table-num block text-[11px] font-medium tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        {rank}
                      </span>
                    </td>
                    <td className="scored-d-fund">
                      <Link
                        href={fundDetailHref(fund.code)}
                        className="flex min-w-0 max-w-full items-center gap-2.5 rounded-md py-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] focus-visible:ring-offset-1 sm:gap-3"
                        style={{ color: "inherit" }}
                      >
                        <FundLogoMark
                          code={fund.code}
                          logoUrl={fund.logoUrl}
                          wrapperClassName="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] sm:h-11 sm:w-11 sm:rounded-[11px]"
                          wrapperStyle={{
                            border: "1px solid var(--border-subtle)",
                            background: "var(--logo-plate-gradient)",
                            color: "var(--text-secondary)",
                          }}
                          imgClassName="h-full w-full object-contain p-1.5"
                          initialsClassName="text-[10px] font-semibold tracking-tight tabular-nums"
                        />
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <p className="truncate text-[14px] font-semibold leading-[1.2] tracking-[-0.022em] sm:text-[15px]" style={{ color: "var(--text-primary)" }}>
                            {fund.code}
                          </p>
                          <p
                            className="mt-[3px] line-clamp-2 text-[12px] leading-[1.38] tracking-[-0.008em] sm:text-[13px] sm:leading-snug"
                            style={{ color: "var(--text-tertiary)" }}
                            title={fund.name}
                          >
                            {subtitle}
                          </p>
                        </div>
                      </Link>
                    </td>
                    <td className="scored-d-cat">
                      <div
                        className="truncate text-[12px] leading-[1.35] tracking-[-0.01em] sm:text-[13px]"
                        style={{ color: "var(--text-secondary)" }}
                        title={categoryTitle}
                      >
                        {categoryName}
                      </div>
                    </td>
                    <td className="scored-d-risk">
                      <RiskPill level={fund.riskLevel} />
                    </td>
                    <td className="scored-d-num table-num whitespace-nowrap">
                      <ReturnBadge value={fund.dailyReturn} />
                    </td>
                    <td className="scored-d-inv table-num whitespace-nowrap">
                      <span className="table-num text-[12px] font-medium tabular-nums tracking-[-0.012em] sm:text-[13px]" style={{ color: "var(--text-secondary)" }}>
                        {formatCompactNumber(fund.investorCount)}
                      </span>
                    </td>
                    <td className="scored-d-aum table-num whitespace-nowrap">
                      <span className="table-num text-[13px] font-semibold tabular-nums tracking-[-0.024em] sm:text-[14px]" style={{ color: "var(--text-primary)" }}>
                        {formatCompactCurrency(fund.portfolioSize)}
                      </span>
                    </td>
                    <td className="scored-d-spark">
                      <div className="sparkline-stack">
                        <div className="sparkline-embed">
                          <Sparkline data={fund.sparkline} width={90} height={21} variant="table" />
                        </div>
                        {spark7d !== null ? (
                          <span
                            className="table-num sparkline-stack__hint sparkline-stack__hint--pct"
                            style={{
                              color:
                                spark7d > 0
                                  ? "var(--success-muted)"
                                  : spark7d < 0
                                    ? "var(--danger-muted)"
                                    : "color-mix(in srgb, var(--accent-blue) 22%, var(--text-secondary))",
                            }}
                          >
                            {spark7d > 0 ? "+" : ""}
                            {spark7d.toFixed(2).replace(".", ",")}%
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
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
      type="button"
      onClick={onClick}
      className="sortable-th-btn table-num text-[10px] font-semibold uppercase tracking-[0.12em]"
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

function formatCompactNumber(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("tr-TR");
}

function formatCompactCurrency(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000_000) return `₺${(n / 1_000_000_000_000).toFixed(1)}Tn`;
  if (n >= 1_000_000_000) return `₺${(n / 1_000_000_000).toFixed(1)}Mr`;
  if (n >= 1_000_000) return `₺${(n / 1_000_000).toFixed(1)}Mn`;
  if (n >= 1_000) return `₺${(n / 1_000).toFixed(1)}K`;
  return `₺${n.toLocaleString("tr-TR")}`;
}

function riskBucketLabel(level: RiskLevel): string {
  if (level === "very_low" || level === "low") return "Düşük";
  if (level === "medium") return "Orta";
  return "Yüksek";
}

function riskBadgeSurface(level: RiskLevel): { background: string; borderColor: string; color: string } {
  if (level === "very_low" || level === "low") {
    return {
      background: "rgba(47, 125, 114, 0.07)",
      borderColor: "rgba(47, 125, 114, 0.14)",
      color: "var(--success)",
    };
  }
  if (level === "medium") {
    return {
      background: "rgba(15, 23, 42, 0.03)",
      borderColor: "rgba(15, 23, 42, 0.072)",
      color: "var(--text-secondary)",
    };
  }
  return {
    background: "rgba(179, 92, 92, 0.07)",
    borderColor: "rgba(179, 92, 92, 0.14)",
    color: "var(--danger)",
  };
}

function RiskPill({ level }: { level: RiskLevel }) {
  const { background, borderColor, color } = riskBadgeSurface(level);
  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center justify-center rounded-[5px] border px-2 py-[3px] text-[9.5px] font-medium leading-none tracking-[-0.015em]"
      style={{ background, borderColor, color, borderWidth: "1px" }}
    >
      {riskBucketLabel(level)}
    </span>
  );
}

function ReturnBadge({ value }: { value: number }) {
  const v = Number(value);
  const isInvalid = !Number.isFinite(v) || Math.abs(v) > 100;
  if (isInvalid) {
    return <span className="table-num text-[12px] sm:text-[13px]" style={{ color: "var(--text-secondary)" }}>—</span>;
  }

  if (v === 0) {
    return (
      <span className="table-num text-[12px] font-medium sm:text-[13px]" style={{ color: "var(--text-secondary)" }}>
        0,00%
      </span>
    );
  }

  const isPositive = v > 0;
  return (
    <span className="table-num text-[12px] font-semibold sm:text-[13px]" style={{ color: isPositive ? "var(--success)" : "var(--danger)" }}>
      {isPositive ? "+" : ""}
      {v.toFixed(2).replace(".", ",")}%
    </span>
  );
}

function MobileFundCard({ fund, rank }: { fund: ScoredFund; rank: number }) {
  const subtitle = (fund.shortName && fund.shortName !== fund.code ? fund.shortName : fund.name).trim();
  const spark7d = sparklinePeriodReturnPct(fund.sparkline);
  return (
    <article
      className="rounded-[var(--radius-lg)] border p-2.5 sm:p-3"
      style={{
        background: "var(--card-bg)",
        borderColor: "var(--border-subtle)",
        boxShadow: "none",
      }}
    >
      <Link
        href={fundDetailHref(fund.code)}
        className="-m-1 block rounded-lg p-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] focus-visible:ring-offset-1"
        style={{ color: "inherit" }}
      >
        <div className="flex items-start gap-3">
          <FundLogoMark
            code={fund.code}
            logoUrl={fund.logoUrl}
            wrapperClassName="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border"
            wrapperStyle={{
              borderColor: "var(--border-default)",
              background: "var(--logo-plate-gradient)",
              color: "var(--text-secondary)",
            }}
            imgClassName="h-full w-full object-contain p-1.5"
            initialsClassName="text-[10px] font-semibold tracking-tight"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {rank}
                  </span>
                  <span className="truncate text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
                    {fund.code}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-snug" style={{ color: "var(--text-secondary)" }} title={fund.name}>
                  {subtitle}
                </p>
              </div>
              <RiskPill level={fund.riskLevel} />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
              <DataTile label="1G" value={<ReturnBadge value={fund.dailyReturn} />} />
              <DataTile label="Yatırımcı" value={<span className="tabular-nums font-medium">{formatCompactNumber(fund.investorCount)}</span>} />
              <DataTile label="Portföy" value={<span className="font-semibold tabular-nums">{formatCompactCurrency(fund.portfolioSize)}</span>} />
            </div>

            <div
              className="mt-3 border-t pt-2.5"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-secondary)" }}>
                7G
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <div className="sparkline-embed sparkline-embed--mobile flex w-full justify-end">
                  <Sparkline data={fund.sparkline} width={88} height={21} variant="table" />
                </div>
                {spark7d !== null ? (
                  <span
                    className="table-num sparkline-stack__hint sparkline-stack__hint--pct text-[9px] font-medium tabular-nums"
                    style={{
                      color:
                        spark7d > 0
                          ? "var(--success-muted)"
                          : spark7d < 0
                            ? "var(--danger-muted)"
                            : "color-mix(in srgb, var(--accent-blue) 22%, var(--text-secondary))",
                    }}
                  >
                    {spark7d > 0 ? "+" : ""}
                    {spark7d.toFixed(2).replace(".", ",")}%
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </Link>
    </article>
  );
}

function DataTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 border-l border-solid pl-2.5" style={{ borderLeftColor: "var(--border-subtle)" }}>
      <p className="text-[9px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-secondary)" }}>
        {label}
      </p>
      <div className="mt-0.5 text-[13px] leading-tight" style={{ color: "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}

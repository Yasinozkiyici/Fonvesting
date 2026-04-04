"use client";

import { useEffect, useState, useCallback } from "react";
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
import type { RankingMode, NormalizedScores, FundMetrics, RiskLevel } from "@/lib/scoring";
import {
  RankingModeToggle,
  Sparkline,
  AlphaBadge,
} from "./ScoringComponents";
import { FundLogoMark } from "./FundLogoMark";

interface ScoredFund {
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  lastPrice: number;
  dailyReturn: number;
  portfolioSize: number;
  investorCount: number;
  category: { code: string; name: string } | null;
  finalScore: number;
  riskLevel: RiskLevel;
  scores: NormalizedScores;
  metrics: FundMetrics;
  alpha: number;
  sparkline: number[];
}

interface ScoredResponse {
  mode: RankingMode;
  total: number;
  funds: ScoredFund[];
}

type SortField = "portfolioSize" | "dailyReturn" | "alpha";
type SortDir = "asc" | "desc";

interface ScoredFundsTableProps {
  enableCategoryFilter?: boolean;
  defaultMode?: RankingMode;
}

export default function ScoredFundsTable({
  enableCategoryFilter = true,
  defaultMode = "BEST",
}: ScoredFundsTableProps) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<ScoredResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>("portfolioSize");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [rankingMode, setRankingMode] = useState<RankingMode>(defaultMode);
  const [categories, setCategories] = useState<Array<{ code: string; name: string }>>([]);
  const [hoveredFund, setHoveredFund] = useState<string | null>(null);
  const pageSize = 50;

  useEffect(() => {
    const sectorParam = searchParams.get("sector") ?? searchParams.get("category") ?? "";
    const qParam = searchParams.get("q") ?? "";
    setCategory(enableCategoryFilter ? sectorParam : "");
    setSearch(qParam);
    setPage(1);
  }, [searchParams, enableCategoryFilter]);

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((rows: Array<{ code: string; name: string }>) =>
        setCategories(rows.map((x) => ({ code: x.code, name: x.name })))
      )
      .catch(console.error);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      mode: rankingMode,
      ...(category && { category }),
    });

    try {
      const res = await fetch(`/api/funds/scores?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ScoredResponse | { error?: string };
      if (!json || !("funds" in json) || !Array.isArray(json.funds)) {
        throw new Error("Skor API beklenen formatta değil");
      }
      setData(json as ScoredResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Veri yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [rankingMode, category]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const resetFilters = () => {
    setSearch("");
    setCategory("");
    setPage(1);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const CATEGORY_SHORT: Record<string, string> = {
    SRB: "Serbest",
    PPF: "Para Piy.",
    ALT: "Altın",
    BRC: "Borçlanma",
    HSF: "Hisse",
    KTL: "Katılım",
    FSP: "Fon Sep.",
    DGS: "Değişken",
    KRM: "Karma",
    DGR: "Diğer",
  };

  const formatPortfolio = (n: number) => {
    if (n >= 1_000_000_000) return `₺${(n / 1_000_000_000).toFixed(1)}Mr`;
    if (n >= 1_000_000) return `₺${(n / 1_000_000).toFixed(0)}Mn`;
    return `₺${n.toLocaleString("tr-TR")}`;
  };

  const formatInvestor = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toLocaleString("tr-TR");
  };

  const filteredFunds = (data?.funds ?? [])
    .filter((f) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return f.code.toLowerCase().includes(q) || f.name.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sortField) {
        case "portfolioSize":
          aVal = a.portfolioSize;
          bVal = b.portfolioSize;
          break;
        case "dailyReturn":
          aVal = a.dailyReturn;
          bVal = b.dailyReturn;
          break;
        case "alpha":
          aVal = a.alpha;
          bVal = b.alpha;
          break;
        default:
          aVal = a.finalScore;
          bVal = b.finalScore;
      }
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });

  const totalPages = Math.ceil(filteredFunds.length / pageSize);
  const paginatedFunds = filteredFunds.slice((page - 1) * pageSize, page * pageSize);
  const hasFilters = Boolean(search || (enableCategoryFilter && category));

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      {/* Header */}
      <div className="border-b px-4 py-3" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              Akıllı Fon Sıralaması
            </h2>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
              {filteredFunds.length} fon
            </p>
          </div>
          <RankingModeToggle mode={rankingMode} onChange={setRankingMode} />
        </div>

        {/* Search */}
        <div className="hidden md:flex items-center gap-2 mt-3">
          <div className="relative flex-1 max-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              placeholder="Fon ara..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="h-8 w-full rounded-md pl-8 pr-2 text-xs focus:outline-none"
              style={{ border: "1px solid var(--border-default)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
            />
          </div>
          {enableCategoryFilter && (
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); setPage(1); }}
              className="h-8 rounded-md px-2 text-xs"
              style={{ border: "1px solid var(--border-default)", background: "var(--bg-surface)", color: "var(--text-secondary)" }}
            >
              <option value="">Tüm kategoriler</option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          )}
          {hasFilters && (
            <button
              onClick={resetFilters}
              className="h-8 px-2 rounded-md text-xs flex items-center gap-1"
              style={{ border: "1px solid var(--border-default)", background: "var(--bg-surface)", color: "var(--text-secondary)" }}
            >
              <X className="h-3 w-3" /> Temizle
            </button>
          )}
        </div>
      </div>

      {/* Table — table-auto + min genişlik: sütun kayması önlenir */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse text-left">
          <thead>
            <tr style={{ background: "var(--table-header-bg)" }}>
              <th className="w-10 py-2.5 pl-4 pr-1 align-middle">
                <span className="text-2xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>#</span>
              </th>
              <th className="min-w-[220px] py-2.5 px-2 align-middle">
                <span className="text-2xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Fon</span>
              </th>
              <th className="w-[100px] py-2.5 px-2 align-middle">
                <span className="text-2xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Kategori</span>
              </th>
              <th className="w-[76px] py-2.5 px-2 text-right align-middle">
                <SortableHeader label="Gün %" field="dailyReturn" currentField={sortField} currentDir={sortDir} onClick={() => handleSort("dailyReturn")} />
              </th>
              <th className="w-[72px] py-2.5 px-2 text-right align-middle">
                <SortableHeader label="Alpha" field="alpha" currentField={sortField} currentDir={sortDir} onClick={() => handleSort("alpha")} />
              </th>
              <th className="w-[52px] py-2.5 px-1 text-center align-middle">
                <span className="text-2xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>Trend</span>
              </th>
              <th className="w-[76px] py-2.5 px-2 text-right align-middle">
                <span className="text-2xs font-semibold uppercase whitespace-nowrap" style={{ color: "var(--text-muted)" }}>Yatırımcı</span>
              </th>
              <th className="w-[96px] py-2.5 pl-2 pr-4 text-right align-middle">
                <SortableHeader label="Portföy" field="portfolioSize" currentField={sortField} currentDir={sortDir} onClick={() => handleSort("portfolioSize")} />
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(10)].map((_, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td colSpan={8} className="py-3 px-4">
                    <div className="h-4 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
                  </td>
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>{error}</td>
              </tr>
            ) : paginatedFunds.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>Fon bulunamadı</td>
              </tr>
            ) : (
              paginatedFunds.map((f, index) => {
                const rank = (page - 1) * pageSize + index + 1;
                const isHovered = hoveredFund === f.fundId;
                const catShort = f.category?.code ? CATEGORY_SHORT[f.category.code] || f.category.name.split(" ")[0] : "—";

                return (
                  <tr
                    key={f.fundId}
                    className="group"
                    style={{
                      borderBottom: "1px solid var(--border-subtle)",
                      background: isHovered ? "var(--table-row-hover)" : undefined,
                    }}
                    onMouseEnter={() => setHoveredFund(f.fundId)}
                    onMouseLeave={() => setHoveredFund(null)}
                  >
                    <td className="py-2 pl-4 pr-1 align-middle">
                      <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{rank}</span>
                    </td>
                    <td className="py-2 px-2 align-middle">
                      <div className="flex items-center gap-2 min-w-0 max-w-[320px]">
                        <FundLogoMark
                          key={`${f.fundId}-${f.logoUrl ?? ""}`}
                          code={f.code}
                          logoUrl={f.logoUrl}
                          wrapperClassName="flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border"
                          wrapperStyle={{
                            borderColor: "var(--border-default)",
                            background: "var(--bg-muted)",
                            color: "var(--text-tertiary)",
                          }}
                          imgClassName="h-full w-full object-contain p-0.5"
                          initialsClassName="text-[9px] font-bold"
                        />
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{f.code}</p>
                          <p className="text-2xs truncate" style={{ color: "var(--text-muted)" }} title={f.name}>{f.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 px-2 align-middle">
                      <span className="block truncate text-2xs" style={{ color: "var(--text-tertiary)" }} title={f.category?.name}>
                        {catShort}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right align-middle whitespace-nowrap">
                      <ReturnBadge value={f.dailyReturn} />
                    </td>
                    <td className="py-2 px-2 text-right align-middle whitespace-nowrap">
                      <AlphaBadge alpha={f.alpha} />
                    </td>
                    <td className="py-2 px-1 align-middle">
                      <div className="flex justify-center">
                        <Sparkline data={f.sparkline} width={36} height={14} />
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right align-middle whitespace-nowrap">
                      <span className="text-2xs tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                        {f.investorCount > 0 ? formatInvestor(f.investorCount) : "—"}
                      </span>
                    </td>
                    <td className="py-2 pl-2 pr-4 text-right align-middle whitespace-nowrap">
                      <span className="text-xs font-medium tabular-nums" style={{ color: "var(--text-secondary)" }}>
                        {formatPortfolio(f.portfolioSize)}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="border-t px-4 py-2 flex items-center justify-between" style={{ borderColor: "var(--border-subtle)", background: "var(--table-header-bg)" }}>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            <strong style={{ color: "var(--text-secondary)" }}>{filteredFunds.length}</strong> fon
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="h-7 w-7 flex items-center justify-center rounded-md disabled:opacity-40"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}
            >
              <ChevronLeft className="h-3.5 w-3.5" style={{ color: "var(--text-secondary)" }} />
            </button>
            <span className="text-xs tabular-nums px-2" style={{ color: "var(--text-secondary)" }}>{page}/{totalPages}</span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="h-7 w-7 flex items-center justify-center rounded-md disabled:opacity-40"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}
            >
              <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--text-secondary)" }} />
            </button>
          </div>
        </div>
      )}
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
      className="inline-flex items-center gap-0.5 text-2xs font-semibold uppercase whitespace-nowrap"
      style={{ color: isActive ? "var(--accent)" : "var(--text-muted)" }}
    >
      {label}
      {isActive ? (
        currentDir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-2.5 w-2.5 opacity-40" />
      )}
    </button>
  );
}

function ReturnBadge({ value }: { value: number }) {
  const isInvalid = !Number.isFinite(value) || Math.abs(value) > 100;
  if (isInvalid) return <span className="text-xs" style={{ color: "var(--text-muted)" }}>—</span>;

  const isPositive = value >= 0;
  return (
    <span className="text-xs font-medium tabular-nums whitespace-nowrap" style={{ color: isPositive ? "var(--success)" : "var(--danger)" }}>
      {isPositive ? "+" : ""}{value.toFixed(2)}%
    </span>
  );
}

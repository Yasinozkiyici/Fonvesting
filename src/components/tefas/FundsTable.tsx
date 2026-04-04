"use client";

import { useEffect, useState } from "react";
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
import { FundLogoMark } from "./FundLogoMark";

interface FundRow {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  portfolioSize: number;
  lastPrice: number;
  previousPrice: number;
  dailyReturn: number;
  investorCount: number;
  category: { code: string; name: string; color: string | null } | null;
  fundType: { code: number; name: string } | null;
}

interface FundsResponse {
  items: FundRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

type SortField = "portfolioSize" | "dailyReturn" | "lastPrice" | "investorCount";
type SortDir = "asc" | "desc";

type FundsTableProps = {
  enableCategoryFilter?: boolean;
};

export default function FundsTable({ enableCategoryFilter = true }: FundsTableProps = {}) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<FundsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>("portfolioSize");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [fundType, setFundType] = useState("");
  const [categories, setCategories] = useState<Array<{ code: string; name: string }>>([]);
  const [fundTypes, setFundTypes] = useState<Array<{ code: number; name: string }>>([]);
  const pageSize = 50;

  useEffect(() => {
    const sectorParam = searchParams.get("sector") ?? searchParams.get("category") ?? "";
    const indexParam = searchParams.get("index") ?? searchParams.get("fundType") ?? "";
    const qParam = searchParams.get("q") ?? "";
    setCategory(enableCategoryFilter ? sectorParam : "");
    setFundType(indexParam);
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

    fetch("/api/fund-types")
      .then((r) => r.json())
      .then((rows: Array<{ code: number; name: string }>) => setFundTypes(rows))
      .catch(console.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: `${sortField}:${sortDir}`,
      ...(search && { q: search }),
      ...(enableCategoryFilter && category && { category }),
      ...(fundType && { fundType }),
    });

    fetch(`/api/funds?${params}`)
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          throw new Error(`Fon API: HTTP ${r.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
        }
        return r.json();
      })
      .then(setData)
      .catch((e) => {
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [page, pageSize, sortField, sortDir, search, category, fundType, enableCategoryFilter]);

  const resetFilters = () => {
    setSearch("");
    setCategory("");
    setFundType("");
    setPage(1);
  };

  const hasFilters = Boolean(search || fundType || (enableCategoryFilter && category));
  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const formatNumber = (n: number) => {
    if (n >= 1_000_000_000_000) return (n / 1_000_000_000_000).toFixed(2) + "T";
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "Mr";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "Mn";
    return n.toLocaleString("tr-TR");
  };

  const formatPrice = (n: number) =>
    n > 0
      ? `₺${n.toLocaleString("tr-TR", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`
      : "—";

  const formatPort = (n: number) => (n > 0 ? `₺${formatNumber(n)}` : "—");

  return (
    <div
      className="overflow-hidden rounded-2xl border shadow-sm"
      style={{ background: "var(--card-bg)", borderColor: "var(--border-default)" }}
    >
      <div className="border-b px-6 py-5" style={{ borderColor: "var(--table-border)" }}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
              TEFAS yatırım fonları
            </h2>
            <p className="mt-1 text-base" style={{ color: "var(--text-muted)" }}>
              Listelenen {data?.total ?? 0} fon • Veri kaynağı TEFAS (senkron ile güncellenir)
            </p>
          </div>
          <div className="hidden flex-col gap-2 md:flex sm:items-end">
            <div className="relative">
              <Search
                className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
                style={{ color: "var(--text-muted)" }}
              />
              <input
                type="text"
                placeholder="Fon kodu veya adı..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="h-11 w-full rounded-xl border pl-10 pr-4 text-sm transition focus:outline-none focus:ring-2 sm:w-72"
                style={{
                  borderColor: "var(--border-default)",
                  background: "var(--bg-surface)",
                  color: "var(--text-primary)",
                  boxShadow: "none",
                }}
              />
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <select
                value={fundType}
                onChange={(e) => {
                  setFundType(e.target.value);
                  setPage(1);
                }}
                className="h-10 rounded-xl border px-3 text-sm"
                style={{
                  borderColor: "var(--border-default)",
                  background: "var(--bg-surface)",
                  color: "var(--text-secondary)",
                }}
              >
                <option value="">Tüm fon türleri</option>
                {fundTypes.map((t) => (
                  <option key={t.code} value={String(t.code)}>
                    {t.name}
                  </option>
                ))}
              </select>
              {enableCategoryFilter && (
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setPage(1);
                  }}
                  className="h-10 rounded-xl border px-3 text-sm"
                  style={{
                    borderColor: "var(--border-default)",
                    background: "var(--bg-surface)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <option value="">Tüm kategoriler</option>
                  {categories.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              {hasFilters && (
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
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
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
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b" style={{ borderColor: "var(--table-border)" }}>
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
              data?.items?.map((f, index) => {
                const rank = (page - 1) * pageSize + index + 1;
                return (
                  <tr
                    key={f.id}
                    className="stocks-row-accent group border-b transition-colors"
                    style={{ borderColor: "var(--table-border)" }}
                  >
                    <td className="px-4 py-4 text-sm font-medium tabular-nums md:px-6" style={{ color: "var(--text-muted)" }}>
                      {rank}
                    </td>
                    <td className="px-4 py-4 md:px-6">
                      <FundCell f={f} />
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-semibold tabular-nums md:px-6" style={{ color: "var(--text-primary)" }}>
                      {formatPrice(f.lastPrice)}
                    </td>
                    <td className="px-4 py-4 text-right md:px-6">
                      <ChangeBadge value={f.dailyReturn} hasData={f.lastPrice > 0} />
                    </td>
                    <td className="hidden px-6 py-4 text-right text-sm tabular-nums lg:table-cell" style={{ color: "var(--text-secondary)" }}>
                      {formatPort(f.portfolioSize)}
                    </td>
                    <td className="hidden px-6 py-4 text-right text-sm tabular-nums xl:table-cell" style={{ color: "var(--text-secondary)" }}>
                      {f.investorCount > 0 ? f.investorCount.toLocaleString("tr-TR") : "—"}
                    </td>
                    <td className="hidden px-6 py-4 xl:table-cell">
                      {f.category ? (
                        <span className="inline-flex rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
                          {f.category.name}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="border-t px-4 py-4 sm:px-6" style={{ borderColor: "var(--table-border)", background: "var(--table-header-bg)" }}>
          <div className="flex items-center justify-between">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
                {data.total.toLocaleString("tr-TR")}
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
                {page} / {data.totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(data.totalPages, page + 1))}
                disabled={page === data.totalPages}
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

function FundCell({ f }: { f: FundRow }) {
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
        <p className="max-w-[320px] truncate text-sm" style={{ color: "var(--text-muted)" }} title={f.name}>
          {f.name}
        </p>
      </div>
    </div>
  );
}

function ChangeBadge({ value, hasData = true }: { value: number; hasData?: boolean }) {
  const isInvalid = !hasData || !Number.isFinite(value) || Math.abs(value) > 100;
  if (isInvalid) {
    return (
      <span
        className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium"
        style={{ borderColor: "var(--border-default)", background: "var(--bg-surface)", color: "var(--text-muted)" }}
      >
        —
      </span>
    );
  }
  const positive = value >= 0;
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums"
      style={{
        borderColor: positive ? "var(--success-border)" : "var(--danger-border)",
        background: positive ? "var(--success-bg)" : "var(--danger-bg)",
        color: positive ? "var(--success)" : "var(--danger)",
      }}
    >
      {positive ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

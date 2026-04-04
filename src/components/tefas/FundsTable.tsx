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
import { fundTypeDisplayLabel } from "@/lib/fund-type-display";

interface FundRow {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  portfolioSize: number;
  lastPrice: number;
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
    const sectorParam = searchParams?.get("sector") ?? searchParams?.get("category") ?? "";
    const indexParam = searchParams?.get("index") ?? searchParams?.get("fundType") ?? "";
    const qParam = searchParams?.get("q") ?? "";
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
      <div className="border-b px-4 py-4 md:px-6 md:py-5" style={{ borderColor: "var(--table-border)" }}>
        <div className="flex flex-col gap-3 md:gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg md:text-2xl font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>
              TEFAS yatırım fonları
            </h2>
            <p className="mt-1 text-xs md:text-base" style={{ color: "var(--text-muted)" }}>
              <span className="font-medium" style={{ color: "var(--text-secondary)" }}>{data?.total?.toLocaleString("tr-TR") ?? "—"}</span> fon
              <span className="hidden md:inline"> • Veri kaynağı TEFAS (senkron ile güncellenir)</span>
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:max-w-none sm:items-end">
            <div className="relative w-full sm:w-72">
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
                className="h-11 w-full rounded-xl border pl-10 pr-4 text-sm transition focus:outline-none focus:ring-2"
                style={{
                  borderColor: "var(--border-default)",
                  background: "var(--bg-surface)",
                  color: "var(--text-primary)",
                  boxShadow: "none",
                }}
              />
            </div>
            <div className="flex w-full flex-wrap gap-2">
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
            <div className="flex w-full gap-2 md:hidden">
              <select
                value={sortField}
                onChange={(e) => {
                  setSortField(e.target.value as SortField);
                  setPage(1);
                }}
                className="min-w-0 flex-1 h-10 rounded-xl px-2 text-xs font-medium"
                style={{
                  borderColor: "var(--border-default)",
                  borderWidth: 1,
                  background: "var(--bg-surface)",
                  color: "var(--text-primary)",
                }}
                aria-label="Sıralama alanı"
              >
                <option value="portfolioSize">Portföy büyüklüğü</option>
                <option value="dailyReturn">Günlük getiri</option>
                <option value="lastPrice">Fiyat</option>
                <option value="investorCount">Yatırımcı sayısı</option>
              </select>
              <select
                value={sortDir}
                onChange={(e) => {
                  setSortDir(e.target.value as SortDir);
                  setPage(1);
                }}
                className="h-10 w-[100px] shrink-0 rounded-xl px-2 text-xs font-medium"
                style={{
                  borderColor: "var(--border-default)",
                  borderWidth: 1,
                  background: "var(--bg-surface)",
                  color: "var(--text-secondary)",
                }}
                aria-label="Sıralama yönü"
              >
                <option value="desc">Azalan</option>
                <option value="asc">Artan</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Mobil kartlar */}
      <div className="md:hidden px-3 py-2 space-y-2">
        {loading ? (
          [...Array(8)].map((_, i) => (
            <div
              key={i}
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
          <p className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>{error}</p>
        ) : !data?.items?.length ? (
          <p className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>Fon bulunamadı</p>
        ) : (
          data.items.map((f, index) => {
            const rank = (page - 1) * pageSize + index + 1;
            return (
              <FundMobileListCard
                key={f.id}
                f={f}
                rank={rank}
                formatPrice={formatPrice}
                formatPort={formatPort}
              />
            );
          })
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
                      <FundCell f={f} formatPrice={formatPrice} />
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
        <div className="border-t px-3 py-3 sm:px-6 sm:py-4" style={{ borderColor: "var(--table-border)", background: "var(--table-header-bg)" }}>
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

function FundCell({ f, formatPrice }: { f: FundRow; formatPrice: (n: number) => string }) {
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
        <p className="max-w-[min(100vw-8rem,320px)] truncate text-sm" style={{ color: "var(--text-muted)" }} title={f.name}>
          {f.name}
        </p>
        <p className="mt-1 sm:hidden text-[11px] leading-snug tabular-nums" style={{ color: "var(--text-tertiary)" }}>
          <span style={{ color: "var(--text-secondary)" }}>Fiyat:</span> {formatPrice(f.lastPrice)}
        </p>
      </div>
    </div>
  );
}

function FundMobileListCard({
  f,
  rank,
  formatPrice,
  formatPort,
}: {
  f: FundRow;
  rank: number;
  formatPrice: (n: number) => string;
  formatPort: (n: number) => string;
}) {
  const hasPrice = f.lastPrice > 0;
  const subtitle = (f.shortName || f.name).trim();

  return (
    <article
      className="rounded-xl px-2.5 py-2 transition-opacity active:opacity-90"
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--border-default)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      <div className="flex items-center gap-2">
        <FundLogoMark
          code={f.code}
          logoUrl={f.logoUrl}
          wrapperClassName="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border"
          wrapperStyle={{
            borderColor: "var(--border-default)",
            background: "var(--bg-muted)",
            color: "var(--text-tertiary)",
          }}
          imgClassName="h-full w-full object-contain p-0.5"
          initialsClassName="text-[10px] font-bold"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-baseline gap-1.5">
              <span className="text-[10px] font-semibold tabular-nums shrink-0" style={{ color: "var(--text-muted)" }}>
                {rank}
              </span>
              <span className="font-bold text-sm leading-tight truncate" style={{ color: "var(--text-primary)" }}>
                {f.code}
              </span>
            </div>
            <FundMobileDailyPercent value={f.dailyReturn} hasData={hasPrice} />
          </div>
          <p className="text-[11px] leading-snug truncate mt-0.5" style={{ color: "var(--text-muted)" }} title={f.name}>
            {subtitle}
          </p>
        </div>
      </div>
      <p
        className="mt-1.5 text-[11px] leading-tight tabular-nums truncate"
        style={{ color: "var(--text-secondary)" }}
        title={`${formatPrice(f.lastPrice)} · ${formatPort(f.portfolioSize)} · ${fundTypeDisplayLabel(f.fundType)}`}
      >
        <span style={{ color: "var(--text-muted)" }}>Fiyat</span>{" "}
        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
          {formatPrice(f.lastPrice)}
        </span>
        <span className="mx-1.5 opacity-35" aria-hidden>
          ·
        </span>
        <span style={{ color: "var(--text-muted)" }}>Portföy</span>{" "}
        <span className="font-semibold">{formatPort(f.portfolioSize)}</span>
        <span className="mx-1.5 opacity-35" aria-hidden>
          ·
        </span>
        <span style={{ color: "var(--text-muted)" }}>Tür</span>{" "}
        <span className="font-medium">{fundTypeDisplayLabel(f.fundType)}</span>
      </p>
    </article>
  );
}

function FundMobileDailyPercent({ value, hasData }: { value: number; hasData: boolean }) {
  const isInvalid = !hasData || !Number.isFinite(value) || Math.abs(value) > 100;
  if (isInvalid) {
    return <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: "var(--text-muted)" }}>—</span>;
  }
  const isPositive = value >= 0;
  return (
    <span
      className="text-sm font-bold tabular-nums leading-none shrink-0"
      style={{ color: isPositive ? "var(--success)" : "var(--danger)" }}
    >
      {isPositive ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

function ChangeBadge({ value, hasData = true }: { value: number; hasData?: boolean }) {
  const v = Number(value);
  const isInvalid = !hasData || !Number.isFinite(v) || Math.abs(v) > 100;
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

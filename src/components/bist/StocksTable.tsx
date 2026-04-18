"use client";

import { Suspense, useDeferredValue, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
} from "@/components/icons";
import {
  fetchNormalizedJson,
  normalizeCategoryOptions,
  normalizeIndexOptions,
  normalizeSparklineResponse,
  normalizeStocksResponse,
  type SparklineApiPayload,
} from "@/lib/client-data";

const SHOW_CLIENT_ERRORS = process.env.NODE_ENV !== "production";

interface Stock {
  id: string;
  symbol: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  marketCap: number;
  lastPrice: number;
  previousClose: number | null;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  turnover: number;
  peRatio: number | null;
  sparkline?: number[];
  sparklineTrend?: "up" | "down" | "flat";
  sector: {
    code: string;
    name: string;
    color: string | null;
  } | null;
}

interface StocksResponse {
  items: Stock[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface SectorOption {
  code: string;
  name: string;
}

interface IndexOption {
  code: string;
  name: string;
}

type SortField = "marketCap" | "changePercent" | "volume" | "lastPrice";
type SortDir = "asc" | "desc";

type StocksTableProps = {
  enableSectorFilter?: boolean;
  initialData?: StocksResponse | null;
  initialSectors?: SectorOption[];
  initialIndices?: IndexOption[];
};

export default function StocksTable(props: StocksTableProps = {}) {
  return (
    <Suspense fallback={<StocksTableFallback />}>
      <StocksTableInner {...props} />
    </Suspense>
  );
}

function StocksTableInner({
  enableSectorFilter = true,
  initialData = null,
  initialSectors = [],
  initialIndices = [],
}: StocksTableProps = {}) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<StocksResponse | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>("marketCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [selectedSector, setSelectedSector] = useState("");
  const [selectedIndex, setSelectedIndex] = useState("");
  const [sectors, setSectors] = useState<SectorOption[]>(initialSectors);
  const [indices, setIndices] = useState<IndexOption[]>(initialIndices);
  const deferredSearch = useDeferredValue(search);
  const pageSize = selectedIndex === "XU100" ? 100 : 50;
  const selectedSectorName = sectors.find((sector) => sector.code === selectedSector)?.name;
  const selectedIndexName = indices.find((index) => index.code === selectedIndex)?.name;
  const hasFilters = Boolean(search || selectedIndex || (enableSectorFilter && selectedSector));
  const activeFilterCount =
    Number(Boolean(search)) +
    Number(Boolean(selectedIndex)) +
    Number(Boolean(enableSectorFilter && selectedSector));

  useEffect(() => {
    const sectorParam = searchParams?.get("sector") ?? "";
    const indexParam = searchParams?.get("index") ?? "";
    const searchParam = searchParams?.get("q") ?? "";

    setSelectedSector(enableSectorFilter ? sectorParam : "");
    setSelectedIndex(indexParam);
    setSearch(searchParam);
    setPage(1);
  }, [searchParams, enableSectorFilter]);

  useEffect(() => {
    let cancelled = false;
    if (initialSectors.length > 0 && initialIndices.length > 0) return;
    fetchNormalizedJson("/api/sectors", "Sektör API", normalizeCategoryOptions)
      .then((result) => {
        if (!cancelled) setSectors(result);
      })
      .catch((error) => {
        if (SHOW_CLIENT_ERRORS) {
          console.error(error);
        }
      });

    fetchNormalizedJson("/api/indices", "Endeks API", normalizeIndexOptions)
      .then((result) => {
        if (!cancelled) setIndices(result);
      })
      .catch((error) => {
        if (SHOW_CLIENT_ERRORS) {
          console.error(error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialIndices.length, initialSectors.length]);

  useEffect(() => {
    const usingInitialSnapshot =
      Boolean(initialData) &&
      page === 1 &&
      sortField === "marketCap" &&
      sortDir === "desc" &&
      !deferredSearch &&
      !(enableSectorFilter && selectedSector) &&
      !selectedIndex;
    if (usingInitialSnapshot) {
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: `${sortField}:${sortDir}`,
      ...(deferredSearch && { q: deferredSearch }),
      ...(enableSectorFilter && selectedSector && { sector: selectedSector }),
      ...(selectedIndex && { index: selectedIndex }),
    });

    fetchNormalizedJson(`/api/stocks?${params}`, "Tablo API", normalizeStocksResponse)
      .then(setData)
      .catch((e) => {
        if (SHOW_CLIENT_ERRORS) {
          console.error(e);
        }
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [deferredSearch, enableSectorFilter, initialData, page, pageSize, selectedIndex, selectedSector, sortDir, sortField]);

  // 7 günlük sparkline'ları lazy yükle (serverless/rate-limit için sınırlı sembol).
  useEffect(() => {
    if (!data?.items?.length) return;

    const controller = new AbortController();
    const maxSymbols = Math.min(50, pageSize); // /api/sparklines route limitine uyumlu
    const symbols = data.items
      .map((s) => s.symbol)
      .filter(Boolean)
      .slice(0, maxSymbols);

    const qs = encodeURIComponent(symbols.join(","));
    fetch(`/api/sparklines?symbols=${qs}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((payload: unknown) => {
        const normalized = normalizeSparklineResponse(payload);
        if (!normalized) return;
        const map: SparklineApiPayload["items"] = normalized.items;

        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map((it) => {
              const spark = map[it.symbol];
              if (!spark?.points?.length) return it;
              return {
                ...it,
                sparkline: spark.points,
                sparklineTrend: spark.trend ?? it.sparklineTrend,
              };
            }),
          };
        });
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        if (SHOW_CLIENT_ERRORS) {
          console.error(e);
        }
      });

    return () => controller.abort();
  }, [data?.items, pageSize]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const resetFilters = () => {
    setSearch("");
    setSelectedSector("");
    setSelectedIndex("");
    setPage(1);
  };

  const toggleIndex = (code: string) => {
    setSelectedIndex((prev) => (prev === code ? "" : code));
    setPage(1);
  };

  const toggleSector = (code: string) => {
    setSelectedSector((prev) => (prev === code ? "" : code));
    setPage(1);
  };

  const formatNumber = (n: number) => {
    if (n >= 1_000_000_000_000) return (n / 1_000_000_000_000).toFixed(2) + "T";
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "Mr";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "Mn";
    return n.toLocaleString("tr-TR");
  };

  const formatVolume = (n: number) => {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "Mr";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "Mn";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "B";
    return n.toLocaleString("tr-TR");
  };

  const formatPrice = (n: number) =>
    n > 0
      ? `₺${n.toLocaleString("tr-TR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "—";

  const formatMarketCap = (n: number) => (n > 0 ? `₺${formatNumber(n)}` : "—");

  return (
    <div
      className="overflow-hidden rounded-2xl border shadow-sm"
      style={{
        background: "var(--card-bg)",
        borderColor: "var(--border-default)",
      }}
    >
      <div className="border-b px-6 py-5" style={{ borderColor: "var(--table-border)" }}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              Tüm Hisseler
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              Borsa İstanbul&apos;da işlem gören {data?.total || 0} hisse senedi
            </p>
          </div>

          <div className="hidden md:flex flex-col gap-2 sm:items-end">
            <div className="relative">
              <Search
                className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
                style={{ color: "var(--text-muted)" }}
              />
              <input
                type="text"
                placeholder="Hisse kodu veya şirket adı..."
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
                value={selectedIndex}
                onChange={(e) => {
                  setSelectedIndex(e.target.value);
                  setPage(1);
                }}
                className="h-10 rounded-xl border px-3 text-sm"
                style={{
                  borderColor: "var(--border-default)",
                  background: "var(--bg-surface)",
                  color: "var(--text-secondary)",
                }}
              >
                <option value="">Tum Endeksler</option>
                {indices.map((index) => (
                  <option key={index.code} value={index.code}>
                    {index.name}
                  </option>
                ))}
              </select>

              {enableSectorFilter && (
                <select
                  value={selectedSector}
                  onChange={(e) => {
                    setSelectedSector(e.target.value);
                    setPage(1);
                  }}
                  className="h-10 rounded-xl border px-3 text-sm"
                  style={{
                    borderColor: "var(--border-default)",
                    background: "var(--bg-surface)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <option value="">Tum Sektorler</option>
                  {sectors.map((sector) => (
                    <option key={sector.code} value={sector.code}>
                      {sector.name}
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
        {hasFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {search && (
              <span
                className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                Arama: {search}
              </span>
            )}
            {selectedIndex && (
              <span
                className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                Endeks: {selectedIndexName || selectedIndex}
              </span>
            )}
            {enableSectorFilter && selectedSector && (
              <span
                className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                Sektor: {selectedSectorName || selectedSector}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mobile-filter-bar sticky top-16 z-20 border-b p-4 md:hidden" style={{ borderColor: "var(--table-border)" }}>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Filtreler
          </p>
          <span
            className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-2 text-xs font-semibold"
            style={{
              borderColor: activeFilterCount > 0 ? "var(--accent)" : "var(--border-default)",
              color: activeFilterCount > 0 ? "var(--accent)" : "var(--text-muted)",
              background: activeFilterCount > 0 ? "var(--accent-bg)" : "var(--bg-surface)",
            }}
          >
            {activeFilterCount}
          </span>
        </div>
        <div className="relative">
          <Search
            className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            type="text"
            placeholder="Hisse kodu veya şirket adı..."
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
            }}
          />
        </div>

        <div className="mt-3 space-y-2">
          <div className="overflow-x-auto pb-1">
            <div className="flex w-max items-center gap-2">
              <button
                onClick={() => setSelectedIndex("")}
                className="inline-flex h-11 items-center rounded-full border px-3 text-sm font-medium"
                style={{
                  borderColor: !selectedIndex ? "var(--accent)" : "var(--border-default)",
                  background: !selectedIndex ? "var(--accent-bg)" : "var(--bg-surface)",
                  color: !selectedIndex ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                Tum Endeksler
              </button>
              {indices.map((index) => (
                <button
                  key={index.code}
                  onClick={() => toggleIndex(index.code)}
                  className="inline-flex h-11 items-center rounded-full border px-3 text-sm font-medium"
                  style={{
                    borderColor: selectedIndex === index.code ? "var(--accent)" : "var(--border-default)",
                    background: selectedIndex === index.code ? "var(--accent-bg)" : "var(--bg-surface)",
                    color: selectedIndex === index.code ? "var(--accent)" : "var(--text-secondary)",
                  }}
                >
                  <span className="max-w-[120px] truncate" title={index.name}>
                    {index.name}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {enableSectorFilter && (
            <div className="overflow-x-auto pb-1">
              <div className="flex w-max items-center gap-2">
                <button
                  onClick={() => setSelectedSector("")}
                  className="inline-flex h-11 items-center rounded-full border px-3 text-sm font-medium"
                  style={{
                    borderColor: !selectedSector ? "var(--accent)" : "var(--border-default)",
                    background: !selectedSector ? "var(--accent-bg)" : "var(--bg-surface)",
                    color: !selectedSector ? "var(--accent)" : "var(--text-secondary)",
                  }}
                >
                  Tum Sektorler
                </button>
                {sectors.map((sector) => (
                  <button
                    key={sector.code}
                    onClick={() => toggleSector(sector.code)}
                    className="inline-flex h-11 items-center rounded-full border px-3 text-sm font-medium"
                    style={{
                      borderColor: selectedSector === sector.code ? "var(--accent)" : "var(--border-default)",
                      background: selectedSector === sector.code ? "var(--accent-bg)" : "var(--bg-surface)",
                      color: selectedSector === sector.code ? "var(--accent)" : "var(--text-secondary)",
                    }}
                  >
                    <span className="max-w-[120px] truncate" title={sector.name}>
                      {sector.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasFilters && (
            <button
              onClick={resetFilters}
              className="inline-flex h-11 w-full items-center justify-center gap-1 rounded-xl border px-3 text-sm font-medium"
              style={{
                borderColor: "var(--border-default)",
                background: "var(--bg-surface)",
                color: "var(--text-secondary)",
              }}
            >
              <X className="h-3.5 w-3.5" />
              Filtreleri Temizle
            </button>
          )}
        </div>
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ background: "var(--table-header-bg)" }}>
              <th
                className="w-12 px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                #
              </th>
              <th
                className="min-w-[260px] px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                HİSSE
              </th>
              <th className="w-[130px] px-6 py-4 text-right">
                <SortableHeader
                  label="FİYAT"
                  field="lastPrice"
                  currentField={sortField}
                  currentDir={sortDir}
                  onClick={() => handleSort("lastPrice")}
                />
              </th>
              <th className="w-[130px] px-6 py-4 text-right">
                <SortableHeader
                  label="DEĞİŞİM"
                  field="changePercent"
                  currentField={sortField}
                  currentDir={sortDir}
                  onClick={() => handleSort("changePercent")}
                />
              </th>
              <th className="hidden w-[160px] px-6 py-4 text-right lg:table-cell">
                <SortableHeader
                  label="PİY. DEĞERİ"
                  field="marketCap"
                  currentField={sortField}
                  currentDir={sortDir}
                  onClick={() => handleSort("marketCap")}
                />
              </th>
              <th className="hidden w-[140px] px-6 py-4 text-right lg:table-cell">
                <SortableHeader
                  label="HACİM"
                  field="volume"
                  currentField={sortField}
                  currentDir={sortDir}
                  onClick={() => handleSort("volume")}
                />
              </th>
              <th
                className="hidden w-[90px] px-6 py-4 text-right text-xs font-semibold uppercase tracking-wide xl:table-cell"
                style={{ color: "var(--text-muted)" }}
              >
                F/K
              </th>
              <th
                className="hidden w-[170px] px-6 py-4 text-left text-xs font-semibold uppercase tracking-wide xl:table-cell"
                style={{ color: "var(--text-muted)" }}
              >
                SEKTÖR
              </th>
              <th
                className="w-[110px] px-6 py-4 text-center text-xs font-semibold uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                7 GÜN
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(10)].map((_, i) => (
                <tr key={i} className="border-b" style={{ borderColor: "var(--table-border)" }}>
                  <td className="px-6 py-5">
                    <div className="h-4 w-6 animate-pulse rounded" style={{ background: "var(--bg-hover)" }} />
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 animate-pulse rounded-full" style={{ background: "var(--bg-hover)" }} />
                      <div className="space-y-2">
                        <div className="h-4 w-16 animate-pulse rounded" style={{ background: "var(--bg-hover)" }} />
                        <div className="h-3 w-24 animate-pulse rounded" style={{ background: "var(--bg-hover)" }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="ml-auto h-4 w-16 animate-pulse rounded" style={{ background: "var(--bg-hover)" }} />
                  </td>
                  <td className="px-6 py-5">
                    <div className="ml-auto h-6 w-16 animate-pulse rounded-full" style={{ background: "var(--bg-hover)" }} />
                  </td>
                  <td className="hidden px-6 py-5 lg:table-cell">
                    <div className="ml-auto h-4 w-20 animate-pulse rounded" style={{ background: "var(--bg-hover)" }} />
                  </td>
                  <td className="hidden px-6 py-5 lg:table-cell">
                    <div className="ml-auto h-4 w-16 animate-pulse rounded" style={{ background: "var(--bg-hover)" }} />
                  </td>
                  <td className="hidden px-6 py-5 xl:table-cell">
                    <div className="ml-auto h-4 w-10 animate-pulse rounded" style={{ background: "var(--bg-hover)" }} />
                  </td>
                  <td className="hidden px-6 py-5 xl:table-cell">
                    <div className="h-6 w-24 animate-pulse rounded-full" style={{ background: "var(--bg-hover)" }} />
                  </td>
                  <td className="px-6 py-5">
                    <div className="mx-auto h-5 w-16 animate-pulse rounded" style={{ background: "var(--bg-hover)" }} />
                  </td>
                </tr>
              ))
            ) : (
              error ? (
                <tr>
                  <td colSpan={9} className="px-6 py-6 text-center" style={{ color: "var(--text-muted)" }}>
                    {error}
                  </td>
                </tr>
              ) : (
                data?.items?.map((stock, index) => {
                const rank = (page - 1) * pageSize + index + 1;
                const isPositive = stock.changePercent >= 0;

                return (
                  <tr
                    key={stock.id}
                    className="stocks-row-accent group border-b transition-colors"
                    style={{ borderColor: "var(--table-border)" }}
                  >
                    <td className="px-6 py-5 text-sm font-medium tabular-nums" style={{ color: "var(--text-muted)" }}>
                      {rank}
                    </td>

                    <td className="px-6 py-5">
                      <StockIdentityCell stock={stock} />
                    </td>

                    <td className="px-6 py-5 text-right text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                      {formatPrice(stock.lastPrice)}
                    </td>

                    <td className="px-6 py-5 text-right">
                      <ChangeBadge value={stock.changePercent} hasData={stock.lastPrice > 0} />
                    </td>

                    <td className="hidden px-6 py-5 text-right text-sm font-medium tabular-nums lg:table-cell" style={{ color: "var(--text-secondary)" }}>
                      {formatMarketCap(stock.marketCap)}
                    </td>

                    <td className="hidden px-6 py-5 text-right text-sm font-medium tabular-nums lg:table-cell" style={{ color: "var(--text-secondary)" }}>
                      ₺{formatVolume(stock.volume)}
                    </td>

                    <td className="hidden px-6 py-5 text-right text-sm font-medium tabular-nums xl:table-cell" style={{ color: "var(--text-secondary)" }}>
                      {stock.peRatio?.toFixed(1) ?? "—"}
                    </td>

                    <td className="hidden px-6 py-5 xl:table-cell">
                      <SectorBadge value={stock.sector?.name} />
                    </td>

                    <td className="px-6 py-5">
                      <div className="mx-auto h-6 w-16">
                        <Sparkline trend={stock.sparklineTrend} points={stock.sparkline} />
                      </div>
                    </td>
                  </tr>
                );
                })
              )
            )}
          </tbody>
        </table>
      </div>

      <div className="md:hidden">
        {loading ? (
          <div className="space-y-3 p-4">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="rounded-xl border p-4"
                style={{ borderColor: "var(--border-default)", background: "var(--bg-surface)" }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 animate-pulse rounded-full" style={{ background: "var(--bg-hover)" }} />
                    <div className="space-y-2">
                      <div className="h-4 w-14 animate-pulse rounded" style={{ background: "var(--bg-hover)" }} />
                      <div className="h-3 w-20 animate-pulse rounded" style={{ background: "var(--bg-hover)" }} />
                    </div>
                  </div>
                  <div className="text-right space-y-2">
                    <div className="ml-auto h-4 w-14 animate-pulse rounded" style={{ background: "var(--bg-hover)" }} />
                    <div className="ml-auto h-5 w-12 animate-pulse rounded-full" style={{ background: "var(--bg-hover)" }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3 p-4">
            {error ? (
              <div style={{ color: "var(--text-muted)" }}>{error}</div>
            ) : (
              data?.items?.map((stock, index) => {
              const rank = (page - 1) * pageSize + index + 1;

              return (
                <div
                  key={stock.id}
                  className="rounded-xl border p-4"
                  style={{ borderColor: "var(--border-default)", background: "var(--bg-surface)" }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="w-5 text-xs font-medium tabular-nums" style={{ color: "var(--text-muted)" }}>
                        {rank}
                      </span>
                      <StockIdentityCell stock={stock} compact />
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                        {formatPrice(stock.lastPrice)}
                      </p>
                      <div className="mt-1">
                        <ChangeBadge value={stock.changePercent} hasData={stock.lastPrice > 0} />
                      </div>
                    </div>
                  </div>

                  <div
                    className="mt-3 grid grid-cols-3 gap-3 border-t pt-3"
                    style={{ borderColor: "var(--table-border)" }}
                  >
                    <div className="min-w-0">
                      <p className="text-2xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                        Sektor
                      </p>
                      <p className="mt-1 text-xs font-medium truncate" style={{ color: "var(--text-secondary)" }} title={stock.sector?.name ?? ""}>
                        {stock.sector?.name ?? "—"}
                      </p>
                    </div>

                    <div className="min-w-0">
                      <p className="text-2xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                        Piyasa Değeri
                      </p>
                      <p className="mt-1 text-xs font-medium tabular-nums truncate" style={{ color: "var(--text-secondary)" }}>
                        {formatMarketCap(stock.marketCap)}
                      </p>
                    </div>

                    <div className="flex flex-col items-end">
                      <p className="text-2xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                        7 Gun
                      </p>
                      <div className="mt-1 h-6 w-16">
                        <Sparkline trend={stock.sparklineTrend} points={stock.sparkline} />
                      </div>
                    </div>
                  </div>
                </div>
              );
              })
            )}
          </div>
        )}
      </div>

      {data && data.totalPages > 1 && (
        <div
          className="border-t px-4 py-4 sm:px-6"
          style={{ borderColor: "var(--table-border)", background: "var(--table-header-bg)" }}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
                {data.total.toLocaleString("tr-TR")}
              </span>{" "}
              hisse
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
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Önceki</span>
              </button>

              <div className="hidden sm:flex items-center gap-1">
                {generatePageNumbers(page, data.totalPages).map((pageNum, i) => (
                  pageNum === "..." ? (
                    <span key={`ellipsis-${i}`} className="px-2" style={{ color: "var(--text-muted)" }}>
                      ...
                    </span>
                  ) : (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum as number)}
                      className="h-11 w-11 rounded-lg border text-sm font-medium transition"
                      style={
                        page === pageNum
                          ? {
                              background: "var(--accent)",
                              color: "#fff",
                              borderColor: "var(--accent)",
                            }
                          : {
                              borderColor: "var(--border-default)",
                              background: "var(--bg-surface)",
                              color: "var(--text-secondary)",
                            }
                      }
                    >
                      {pageNum}
                    </button>
                  )
                ))}
              </div>

              <span className="text-sm sm:hidden" style={{ color: "var(--text-secondary)" }}>
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
                <span className="hidden sm:inline">Sonraki</span>
                <ChevronRight className="w-4 h-4" />
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

function StockIdentityCell({ stock, compact = false }: { stock: Stock; compact?: boolean }) {
  const label = stock.logoUrl ? (
    <img src={stock.logoUrl} alt={stock.symbol} className="h-full w-full rounded-full object-cover" />
  ) : (
    <span>{stock.symbol.slice(0, 2)}</span>
  );

  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-full border text-xs font-semibold"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-hover)",
          color: "var(--text-secondary)",
        }}
      >
        {label}
      </div>
      <div className="min-w-0">
        <p
          className={`font-semibold ${compact ? "text-sm" : "text-[15px]"}`}
          style={{ color: "var(--text-primary)" }}
        >
          {stock.symbol}
        </p>
        <p
          className={`truncate ${compact ? "max-w-[120px] text-xs" : "max-w-[220px] text-sm"}`}
          style={{ color: "var(--text-muted)" }}
        >
          {stock.shortName || stock.name}
        </p>
      </div>
    </div>
  );
}

function ChangeBadge({ value, hasData = true }: { value: number; hasData?: boolean }) {
  if (!hasData) {
    return (
      <span
        className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-surface)",
          color: "var(--text-muted)",
        }}
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

function SectorBadge({ value }: { value?: string }) {
  if (!value) return <span className="text-sm" style={{ color: "var(--text-muted)" }}>—</span>;
  return (
    <span
      className="inline-flex rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}
    >
      {value}
    </span>
  );
}

function Sparkline({
  points,
  trend = "flat",
}: {
  points?: number[];
  trend?: "up" | "down" | "flat";
}) {
  const stroke =
    trend === "up" ? "var(--success)" : trend === "down" ? "var(--danger)" : "var(--text-muted)";

  if (!points || points.length < 2) {
    return (
      <svg viewBox="0 0 56 24" className="w-full h-full">
        <path
          d="M2,12 L54,12"
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = 52 / (points.length - 1);
  const d = points
    .map((value, i) => {
      const x = 2 + i * stepX;
      const normalized = (value - min) / range;
      const y = 20 - normalized * 16;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 56 24" className="w-full h-full">
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function generatePageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  if (current <= 4) {
    return [1, 2, 3, 4, 5, '...', total];
  }

  if (current >= total - 3) {
    return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  }

  return [1, '...', current - 1, current, current + 1, '...', total];
}

function StocksTableFallback() {
  return (
    <div
      className="overflow-hidden rounded-2xl border p-6 shadow-sm"
      style={{ background: "var(--card-bg)", borderColor: "var(--border-default)" }}
    >
      <div className="space-y-3">
        <div className="h-6 w-40 animate-pulse rounded" style={{ background: "var(--bg-hover)" }} />
        <div className="h-4 w-64 animate-pulse rounded" style={{ background: "var(--bg-hover)" }} />
        <div className="grid gap-3 pt-2 md:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-20 animate-pulse rounded-xl border"
              style={{ borderColor: "var(--border-default)", background: "var(--bg-surface)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

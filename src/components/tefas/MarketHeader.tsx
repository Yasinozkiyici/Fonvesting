"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Coins,
  Landmark,
  PieChart,
  Shield,
} from "lucide-react";

export interface MarketApi {
  summary: { avgDailyReturn: number; totalFundCount: number };
  fundCount: number;
  totalPortfolioSize: number;
  totalInvestorCount: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  lastSyncedAt: string | null;
  snapshotDate: string | null;
  usdTry: number | null;
  eurTry: number | null;
  topGainers: Array<unknown>;
  topLosers: Array<unknown>;
  formatted: {
    totalPortfolioSize: string;
    totalInvestorCount: string;
  };
}

export interface CategoryRow {
  id: string;
  code: string;
  name: string;
  color: string | null;
  fundCount: number;
  avgDailyReturn: number;
  totalPortfolioSize: number;
}

const PRIMARY_CATEGORIES: Record<string, { name: string; short: string; icon: ReactNode }> = {
  PPF: { name: "Para Piyasası", short: "Para Piyasası", icon: <Landmark className="h-[11px] w-[11px]" strokeWidth={1.75} /> },
  HSF: { name: "Hisse Odaklı", short: "Hisse", icon: <BarChart3 className="h-[11px] w-[11px]" strokeWidth={1.75} /> },
  ALT: { name: "Altın & Emtia", short: "Altın", icon: <Coins className="h-[11px] w-[11px]" strokeWidth={1.75} /> },
  BRC: { name: "Borçlanma Araçları", short: "Borçlanma", icon: <Building2 className="h-[11px] w-[11px]" strokeWidth={1.75} /> },
  KTL: { name: "Katılım Fonları", short: "Katılım", icon: <Shield className="h-[11px] w-[11px]" strokeWidth={1.75} /> },
};

/** Piyasa özeti: kısaltma yok, Türkçe gruplu tam gösterim */
function formatFullTl(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `₺${Math.round(v).toLocaleString("tr-TR")}`;
}

function formatFullInteger(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return "—";
  return Math.round(v).toLocaleString("tr-TR");
}

function formatUsdTry(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function isCompleteMarketApi(x: unknown): x is MarketApi {
  if (!x || typeof x !== "object") return false;
  const d = x as Record<string, unknown>;
  const nums = [d.fundCount, d.totalPortfolioSize, d.totalInvestorCount, d.advancers, d.decliners];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  const s = d.summary;
  if (!s || typeof s !== "object") return false;
  const sum = s as Record<string, unknown>;
  if (typeof sum.avgDailyReturn !== "number" || !Number.isFinite(sum.avgDailyReturn)) return false;
  if (typeof sum.totalFundCount !== "number" || !Number.isFinite(sum.totalFundCount)) return false;
  return true;
}

export default function MarketHeader({
  initialData,
  initialCategories = [],
}: {
  initialData?: MarketApi | null;
  initialCategories?: CategoryRow[];
}) {
  const searchParams = useSearchParams();
  const activeSector = searchParams?.get("sector") ?? searchParams?.get("category") ?? "";

  const seededMarket = isCompleteMarketApi(initialData) ? initialData : null;
  const [data, setData] = useState<MarketApi | null>(seededMarket);
  const [categories, setCategories] = useState<CategoryRow[]>(initialCategories);
  const [loading, setLoading] = useState(!seededMarket);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isCompleteMarketApi(initialData) && initialCategories.length > 0) return;

    const fetchJson = async (url: string) => {
      const r = await fetch(url);
      const text = await r.text();
      if (!r.ok) throw new Error(`API error: HTTP ${r.status} - ${text.slice(0, 200)}`);
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`API invalid JSON: HTTP ${r.status}`);
      }
    };

    Promise.all([fetchJson("/api/market"), fetchJson("/api/categories")])
      .then(([marketData, catData]) => {
        if (!isCompleteMarketApi(marketData)) {
          throw new Error("Piyasa API geçersiz veya eksik yanıt döndü");
        }
        if (!Array.isArray(catData)) {
          throw new Error("Kategori API geçersiz yanıt döndü");
        }
        setData(marketData);
        setCategories(catData as CategoryRow[]);
      })
      .catch((e) => {
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [initialCategories.length, initialData]);

  if (loading) {
    return (
      <section className="space-y-3 sm:space-y-4">
        <div className="ds-hero-compact">
          <div className="ds-hero-compact__intro space-y-2">
            <div className="skeleton h-2.5 w-32 rounded-full" />
            <div className="skeleton h-7 w-[min(100%,16rem)] rounded-md" />
            <div className="ds-hero-stats market-snapshot-bar mt-3 flex animate-pulse items-stretch">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Fragment key={i}>
                  <div className="flex min-w-[4.25rem] flex-col justify-center gap-1.5 px-2 sm:px-3">
                    <div className="skeleton h-2 w-9 rounded-full opacity-60" />
                    <div className="skeleton h-[18px] w-[3.25rem] rounded-md opacity-80" />
                  </div>
                  {i < 5 ? (
                    <span
                      className="market-snapshot-sep my-1 shrink-0 opacity-40"
                      style={{ background: "var(--border-subtle)" }}
                      aria-hidden
                    />
                  ) : null}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
        <div className="category-rail-section px-0 pb-0 pt-2 sm:pt-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2 sm:mb-2">
            <div className="skeleton h-3 w-36 rounded-full opacity-80" />
            <div className="skeleton h-3 w-10 rounded-full opacity-60" />
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 sm:grid-cols-3 sm:gap-x-2.5 xl:grid-cols-6">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="flex min-h-[36px] items-start gap-2 rounded-md border-l-[1.5px] border-l-transparent py-1 pl-2 pr-1 sm:min-h-[38px]"
              >
                <div className="skeleton mt-0.5 h-3 w-3 shrink-0 rounded-sm opacity-70" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="skeleton h-2.5 w-16 rounded-full opacity-75" />
                    <div className="skeleton h-2.5 w-7 shrink-0 rounded-full opacity-55" />
                  </div>
                  <div className="skeleton h-2 w-20 rounded-full opacity-45" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {error ?? "Piyasa özeti yüklenemedi. Veritabanı bağlantısını ve günlük anlık görüntüyü kontrol edin."}
      </p>
    );
  }

  if (!isCompleteMarketApi(data)) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Piyasa verisi eksik; sayfa yenilendiğinde tekrar denenecek.
      </p>
    );
  }

  const primaryCategories = Object.keys(PRIMARY_CATEGORIES)
    .map((code) => categories.find((category) => category.code === code))
    .filter(Boolean) as CategoryRow[];

  const largestCategory =
    categories.reduce<CategoryRow | null>((largest, current) => {
      if (!largest || current.totalPortfolioSize > largest.totalPortfolioSize) return current;
      return largest;
    }, null) ?? null;

  const activePrimaryCode = primaryCategories.find((category) => category.code === activeSector)?.code ?? activeSector;

  const largestLabel =
    largestCategory != null
      ? (PRIMARY_CATEGORIES[largestCategory.code]?.short ?? largestCategory.name.split(/\s+/)[0] ?? "—")
      : "—";

  const avg1g = data.summary.avgDailyReturn;
  const avg1gStr = `${avg1g >= 0 ? "+" : ""}${avg1g.toFixed(2)}%`;

  return (
    <section className="space-y-3 sm:space-y-4">
      <div className="ds-hero-compact">
        <div className="ds-hero-compact__intro">
          <p className="hero-kicker">Türkiye yatırım fonları</p>
          <h1 className="ds-hero-title">Piyasa özeti</h1>
          <p className="hero-lede mt-2 hidden text-[13px] leading-snug sm:block" style={{ color: "var(--text-secondary)" }}>
            Günlük anlık görüntü — AUM, yatırımcı ve getiri özeti.
          </p>
        </div>

        <div className="ds-hero-stats market-snapshot-bar" role="group" aria-label="Piyasa metrikleri">
          <div className="market-snapshot-item">
            <span className="market-snapshot-k">AUM</span>
            <span className="market-snapshot-v tabular-nums">{formatFullTl(data.totalPortfolioSize)}</span>
          </div>
          <span className="market-snapshot-sep" aria-hidden />
          <div className="market-snapshot-item">
            <span className="market-snapshot-k">Yatırımcı</span>
            <span className="market-snapshot-v tabular-nums">{formatFullInteger(data.totalInvestorCount)}</span>
          </div>
          <span className="market-snapshot-sep" aria-hidden />
          <div className="market-snapshot-item">
            <span className="market-snapshot-k">Fon</span>
            <span className="market-snapshot-v tabular-nums">{data.fundCount.toLocaleString("tr-TR")}</span>
          </div>
          <span className="market-snapshot-sep" aria-hidden />
          <div className="market-snapshot-item">
            <span className="market-snapshot-k">Ort. 1G</span>
            <span
              className={`market-snapshot-v tabular-nums ${avg1g >= 0 ? "market-snapshot-v--pos" : "market-snapshot-v--neg"}`}
            >
              {avg1gStr}
            </span>
          </div>
          <span className="market-snapshot-sep" aria-hidden />
          <div className="market-snapshot-item">
            <span className="market-snapshot-k">USD/TRY</span>
            <span className="market-snapshot-v tabular-nums" title={data.usdTry != null ? `1 USD = ${formatUsdTry(data.usdTry)} TRY` : undefined}>
              {formatUsdTry(data.usdTry)}
            </span>
          </div>
          <span className="market-snapshot-sep" aria-hidden />
          <div className="market-snapshot-item market-snapshot-item--wide">
            <span className="market-snapshot-k">Öne çıkan kategori</span>
            <span className="market-snapshot-v market-snapshot-v--truncate" title={largestLabel}>
              {largestLabel}
            </span>
          </div>
        </div>
      </div>

      <section className="category-rail-section px-0 pb-0 pt-2 sm:pt-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-3 sm:mb-2">
          <h2 className="text-heading-section">Kategoriye göre keşfet</h2>
          <Link
            href="/sectors"
            className="hidden shrink-0 items-center gap-1 text-[11px] font-medium tracking-tight transition-opacity hover:opacity-70 sm:inline-flex"
            style={{ color: "var(--text-secondary)" }}
          >
            Tümü
            <ArrowRight className="h-3 w-3" strokeWidth={2} aria-hidden />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-x-2 gap-y-1 sm:grid-cols-3 sm:gap-x-2.5 xl:grid-cols-6">
          <CategoryCard
            href="/"
            active={activePrimaryCode === ""}
            icon={<PieChart className="h-[11px] w-[11px]" strokeWidth={1.75} />}
            label="Tümü"
            count={data.fundCount}
            subtitle="Tüm fonlar"
          />
          {primaryCategories.map((category) => {
            const config = PRIMARY_CATEGORIES[category.code];
            return (
              <CategoryCard
                key={category.id}
                href={`/?sector=${encodeURIComponent(category.code)}`}
                active={activePrimaryCode === category.code}
                icon={config?.icon ?? <PieChart className="h-[11px] w-[11px]" strokeWidth={1.75} />}
                label={config?.name ?? category.name}
                count={category.fundCount}
                subtitle={`${(Number(category.avgDailyReturn) || 0) >= 0 ? "+" : ""}${(Number(category.avgDailyReturn) || 0).toFixed(2)}% ort. 1G`}
              />
            );
          })}
        </div>
      </section>
    </section>
  );
}

function CategoryCard({
  href,
  active,
  icon,
  label,
  count,
  subtitle,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  label: string;
  count: number;
  subtitle: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      data-active={active ? "true" : "false"}
      className="category-rail-card flex min-h-[34px] items-start gap-1.5 rounded-md py-0.5 pl-2 pr-1 sm:min-h-[36px]"
      style={{
        borderLeftWidth: 1.5,
        borderLeftStyle: "solid",
        borderLeftColor: active ? "var(--accent-blue)" : "transparent",
        boxShadow: "none",
      }}
    >
      <div
        className="mt-0.5 flex shrink-0 items-center justify-center [&_svg]:block"
        style={{ color: active ? "var(--accent-blue)" : "var(--text-secondary)" }}
      >
        {icon}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-1.5">
          <h3
            className="min-w-0 truncate text-[11px] font-semibold leading-[1.2] tracking-[-0.021em] sm:text-[11.5px]"
            style={{ color: "var(--text-primary)", fontWeight: active ? 700 : 600 }}
          >
            {label}
          </h3>
          <span
            className="table-num shrink-0 text-[10px] font-semibold tabular-nums leading-none tracking-[-0.018em] opacity-[0.66] sm:text-[10.25px]"
            style={{ color: "var(--text-primary)" }}
          >
            {(Number.isFinite(count) ? count : 0).toLocaleString("tr-TR")}
          </span>
        </div>
        <p
          className="mt-[3px] text-[8.25px] leading-[1.35] tracking-[-0.01em] sm:text-[8.75px]"
          style={{ color: "var(--text-tertiary)", opacity: 0.88 }}
        >
          {subtitle}
        </p>
      </div>
    </Link>
  );
}

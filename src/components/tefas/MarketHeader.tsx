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
  Users,
  Wallet,
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

function formatCompactTl(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (v >= 1e12) return `₺${(v / 1e12).toFixed(1)}Tn`;
  if (v >= 1e9) return `₺${(v / 1e9).toFixed(1)}Mr`;
  if (v >= 1e6) return `₺${(v / 1e6).toFixed(1)}Mn`;
  if (v >= 1e3) return `₺${(v / 1e3).toFixed(1)}K`;
  return `₺${v.toLocaleString("tr-TR")}`;
}

function formatCompactNumber(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString("tr-TR");
}

/** Kısmi / bozuk API yanıtında render çökmesini önler (beyaz ekran). */
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
        <div className="hero-section">
          <div className="hero-product__intro space-y-2.5">
            <div className="skeleton h-2.5 w-36 rounded-full" />
            <div className="skeleton h-8 w-[min(100%,20rem)] rounded-md" />
            <div className="skeleton h-4 w-full max-w-lg rounded-md" />
            <div className="skeleton h-4 w-4/5 max-w-md rounded-md" />
          </div>
          <div className="hero-metrics-panel" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <Fragment key={i}>
                {i > 0 ? <span className="hero-metric-sep" /> : null}
                <div className="hero-metric-cell">
                  <div className="flex gap-3 sm:gap-3.5">
                    <div className="skeleton mt-0.5 h-[18px] w-[18px] shrink-0 rounded-sm opacity-80" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="skeleton h-2 w-20 rounded-full opacity-70" />
                      <div className="skeleton h-7 w-[min(100%,7.5rem)] rounded-md" />
                      <div className="skeleton h-3 w-[min(100%,9rem)] rounded-full opacity-60" />
                    </div>
                  </div>
                </div>
              </Fragment>
            ))}
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
                className="flex min-h-[36px] items-start gap-2 rounded-md border-l-2 border-l-transparent py-1 pl-2 pr-1 sm:min-h-[38px]"
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

  return (
    <section className="space-y-3 sm:space-y-4">
      <div className="hero-section">
        <div className="hero-product__intro">
          <p className="hero-kicker">Türkiye yatırım fonları</p>
          <h1 className="hero-title">Piyasa özeti</h1>
          <p className="hero-lede">Günlük anlık görüntüye göre portföy büyüklüğü, yatırımcı dağılımı ve kategori performansı — tek ekranda.</p>
        </div>

        <div className="hero-metrics-panel" role="group" aria-label="Piyasa metrikleri">
          <HeroMetricCell
            tone="accent"
            icon={<Wallet strokeWidth={1.85} />}
            label="Toplam AUM"
            value={formatCompactTl(data.totalPortfolioSize)}
            supporting={`${formatCompactNumber(data.fundCount)} fon`}
          />
          <span className="hero-metric-sep" aria-hidden />
          <HeroMetricCell
            tone="accent"
            icon={<Users strokeWidth={1.85} />}
            label="Yatırımcı"
            value={formatCompactNumber(data.totalInvestorCount)}
            supporting={`${data.advancers} yükselen · ${data.decliners} düşen`}
          />
          <span className="hero-metric-sep" aria-hidden />
          <HeroMetricCell
            tone={data.summary.avgDailyReturn >= 0 ? "success" : "danger"}
            icon={<PieChart strokeWidth={1.85} />}
            label="Aktif fon"
            value={data.fundCount.toLocaleString("tr-TR")}
            supporting={`Ort. 1G ${data.summary.avgDailyReturn >= 0 ? "+" : ""}${data.summary.avgDailyReturn.toFixed(2)}%`}
          />
          <span className="hero-metric-sep" aria-hidden />
          <HeroMetricCell
            tone="neutral"
            icon={<Landmark strokeWidth={1.85} />}
            label="En büyük kategori"
            value={
              largestCategory ? (PRIMARY_CATEGORIES[largestCategory.code]?.name ?? largestCategory.name) : "—"
            }
            supporting={largestCategory ? `${formatCompactTl(largestCategory.totalPortfolioSize)} AUM` : "—"}
            valueSize="compact"
          />
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
            <ArrowRight className="h-3 w-3" strokeWidth={2} />
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

function HeroMetricCell({
  icon,
  label,
  value,
  supporting,
  tone = "accent",
  valueSize = "default",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  supporting: string;
  tone?: "accent" | "success" | "danger" | "neutral";
  /** Uzun metin değerleri (ör. kategori adı) için daha küçük başlık */
  valueSize?: "default" | "compact";
}) {
  return (
    <div className="hero-metric-cell">
      <div className="flex gap-3 sm:gap-3.5">
        <div
          className="hero-metric-icon mt-0.5 flex shrink-0 items-start justify-center [&_svg]:block [&_svg]:h-[19px] [&_svg]:w-[19px]"
          data-tone={tone}
          aria-hidden
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="hero-metric-label">{label}</p>
          <p
            className={`hero-metric-value tabular-nums ${valueSize === "compact" ? "hero-metric-value--compact" : ""}`.trim()}
          >
            {value}
          </p>
          <p className="hero-metric-support">{supporting}</p>
        </div>
      </div>
    </div>
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

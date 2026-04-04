"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  BarChart3,
  Building2,
  Coins,
  Landmark,
  PieChart,
  Shield,
} from "lucide-react";
import { CategoryTabs, type CategoryTabItem } from "@/components/ds/CategoryTabs";

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
      <section className="space-y-3">
        <div className="ds-hero-compact">
          <div className="ds-hero-compact__intro space-y-2">
            <div className="skeleton h-2.5 w-32 rounded-full" />
            <div className="skeleton h-7 w-[min(100%,16rem)] rounded-md" />
            <div className="skeleton h-10 w-full max-w-2xl rounded-lg" />
          </div>
        </div>
        <div className="category-tabs-sticky">
          <div className="skeleton mb-2 h-3 w-40 rounded-full" />
          <div className="flex gap-2 overflow-hidden">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="skeleton h-14 w-[5.5rem] shrink-0 rounded-[10px]" />
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

  const tabItems: CategoryTabItem[] = [
    {
      href: "/",
      label: "Tümü",
      active: activePrimaryCode === "",
      count: data.fundCount,
      subtitle: "Tüm fonlar",
      icon: <PieChart className="h-[11px] w-[11px]" strokeWidth={1.75} />,
    },
    ...primaryCategories.map((category) => {
      const config = PRIMARY_CATEGORIES[category.code];
      return {
        href: `/?sector=${encodeURIComponent(category.code)}`,
        label: config?.name ?? category.name,
        active: activePrimaryCode === category.code,
        count: category.fundCount,
        subtitle: `${(Number(category.avgDailyReturn) || 0) >= 0 ? "+" : ""}${(Number(category.avgDailyReturn) || 0).toFixed(2)}% 1G`,
        icon: config?.icon ?? <PieChart className="h-[11px] w-[11px]" strokeWidth={1.75} />,
      };
    }),
  ];

  const avg1g = data.summary.avgDailyReturn;
  const avg1gStr = `${avg1g >= 0 ? "+" : ""}${avg1g.toFixed(2)}%`;

  return (
    <section className="space-y-0">
      <div className="ds-hero-compact">
        <div className="ds-hero-compact__intro">
          <p className="hero-kicker">Türkiye yatırım fonları</p>
          <h1 className="ds-hero-title">Piyasa özeti</h1>
          <p className="hero-lede mt-2 hidden text-[13px] leading-snug sm:block" style={{ color: "var(--text-secondary)" }}>
            Günlük anlık görüntü — AUM, yatırımcı ve getiri özeti.
          </p>
        </div>

        <div className="ds-hero-stats" role="group" aria-label="Piyasa metrikleri">
          <span>
            <strong className="ds-hero-stat-label">AUM</strong>
            <span className="tabular-nums">{formatCompactTl(data.totalPortfolioSize)}</span>
          </span>
          <span className="ds-hero-stat-dot" aria-hidden>
            ·
          </span>
          <span>
            <strong className="ds-hero-stat-label">Yatırımcı</strong>
            <span className="tabular-nums">{formatCompactNumber(data.totalInvestorCount)}</span>
          </span>
          <span className="ds-hero-stat-dot" aria-hidden>
            ·
          </span>
          <span>
            <strong className="ds-hero-stat-label">Fon</strong>
            <span className="tabular-nums">{data.fundCount.toLocaleString("tr-TR")}</span>
          </span>
          <span className="ds-hero-stat-dot" aria-hidden>
            ·
          </span>
          <span>
            <strong className="ds-hero-stat-label">Ort. 1G</strong>
            <span className="tabular-nums">{avg1gStr}</span>
          </span>
          <span className="ds-hero-stat-dot" aria-hidden>
            ·
          </span>
          <span>
            <strong className="ds-hero-stat-label">Öne çıkan</strong>
            <span className="tabular-nums">{largestLabel}</span>
          </span>
        </div>
      </div>

      <CategoryTabs title="Kategoriler" items={tabItems} allHref="/sectors" allLabel="Tümü" />
    </section>
  );
}

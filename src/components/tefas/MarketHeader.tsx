"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Users,
  PieChart,
  ArrowRight,
  Coins,
  Building2,
  Landmark,
  BarChart3,
  Shield,
} from "lucide-react";

interface MarketApi {
  summary: { avgDailyReturn: number; totalFundCount: number };
  fundCount: number;
  totalPortfolioSize: number;
  totalInvestorCount: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  usdTry: number | null;
  eurTry: number | null;
  topGainers: Array<{
    code: string;
    name: string;
    shortName: string | null;
    lastPrice: number;
    dailyReturn: number;
    portfolioSize: number;
  }>;
  topLosers: Array<{
    code: string;
    name: string;
    shortName: string | null;
    lastPrice: number;
    dailyReturn: number;
    portfolioSize: number;
  }>;
  formatted: {
    totalPortfolioSize: string;
    totalInvestorCount: string;
  };
}

interface CategoryRow {
  id: string;
  code: string;
  name: string;
  color: string | null;
  fundCount: number;
  avgDailyReturn: number;
  totalPortfolioSize: number;
}

// Curated primary categories with descriptions
const PRIMARY_CATEGORIES: Record<string, { name: string; description: string; icon: React.ReactNode }> = {
  PPF: {
    name: "Para Piyasası",
    description: "Düşük risk, sabit getiri odaklı",
    icon: <Landmark className="h-4 w-4" />,
  },
  HSF: {
    name: "Hisse Odaklı",
    description: "Borsa endekslerine yatırım",
    icon: <BarChart3 className="h-4 w-4" />,
  },
  ALT: {
    name: "Altın & Emtia",
    description: "Kıymetli maden ve emtia",
    icon: <Coins className="h-4 w-4" />,
  },
  BRC: {
    name: "Borçlanma Araçları",
    description: "Tahvil ve bono fonları",
    icon: <Building2 className="h-4 w-4" />,
  },
  KTL: {
    name: "Katılım Fonları",
    description: "Faizsiz yatırım araçları",
    icon: <Shield className="h-4 w-4" />,
  },
};

export default function MarketHeader() {
  const [data, setData] = useState<MarketApi | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
        if (
          !marketData ||
          typeof marketData !== "object" ||
          typeof (marketData as MarketApi).fundCount !== "number" ||
          !Array.isArray((marketData as MarketApi).topGainers) ||
          !Array.isArray((marketData as MarketApi).topLosers)
        ) {
          throw new Error("Piyasa API geçersiz yanıt döndü");
        }
        if (!Array.isArray(catData)) {
          throw new Error("Kategori API geçersiz yanıt döndü");
        }
        setData(marketData as MarketApi);
        setCategories(catData as CategoryRow[]);
        setError(null);
      })
      .catch((e) => {
        console.error(e);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="rounded-lg p-4"
              style={{ background: "var(--bg-muted)", border: "1px solid var(--border-subtle)" }}
            >
              <div className="skeleton h-3 w-16 mb-2" />
              <div className="skeleton h-6 w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) return error ? <div className="p-4" style={{ color: "var(--text-muted)" }}>{error}</div> : null;

  const formatCompact = (n: number) => {
    if (n >= 1e12) return `₺${(n / 1e12).toFixed(1)}T`;
    if (n >= 1e9) return `₺${(n / 1e9).toFixed(1)}Mr`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    return n.toLocaleString("tr-TR");
  };

  // Get only the 5 primary categories
  const primaryCats = Object.keys(PRIMARY_CATEGORIES)
    .map((code) => categories.find((c) => c.code === code))
    .filter(Boolean) as CategoryRow[];

  return (
    <div className="space-y-6">
      {/* Compact Summary Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Toplam Portföy"
          value={formatCompact(data.totalPortfolioSize)}
          icon={<Wallet className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Yatırımcı Sayısı"
          value={formatCompact(data.totalInvestorCount)}
          icon={<Users className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="Aktif Fon"
          value={data.fundCount.toLocaleString("tr-TR")}
          icon={<PieChart className="h-3.5 w-3.5" />}
          secondary={
            <span className="flex items-center gap-1.5 text-xs">
              <span style={{ color: "var(--success)" }}>↑{data.advancers}</span>
              <span style={{ color: "var(--danger)" }}>↓{data.decliners}</span>
            </span>
          }
        />
        <StatCard
          label="Günlük Ortalama"
          value={`${data.summary.avgDailyReturn >= 0 ? "+" : ""}${data.summary.avgDailyReturn.toFixed(2)}%`}
          valueColor={data.summary.avgDailyReturn >= 0 ? "var(--success)" : "var(--danger)"}
          icon={<BarChart3 className="h-3.5 w-3.5" />}
        />
      </div>

      {/* Curated Categories - Simplified */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            Kategoriler
          </h2>
          <Link
            href="/sectors"
            className="inline-flex items-center gap-1 text-sm font-medium transition-colors hover:underline"
            style={{ color: "var(--text-tertiary)" }}
          >
            Tümünü gör
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {primaryCats.map((cat) => {
            const config = PRIMARY_CATEGORIES[cat.code];
            return (
              <CategoryCard
                key={cat.id}
                code={cat.code}
                name={config?.name || cat.name}
                description={config?.description || ""}
                icon={config?.icon || <PieChart className="h-4 w-4" />}
                fundCount={cat.fundCount}
                dailyReturn={cat.avgDailyReturn}
              />
            );
          })}
        </div>
      </section>

      {/* Winners & Losers - Minimal */}
      <section className="grid gap-3 md:grid-cols-2">
        <MiniPerformanceList
          title="Günün Kazananları"
          items={data.topGainers.slice(0, 3)}
          type="gainer"
        />
        <MiniPerformanceList
          title="Günün Kaybedenleri"
          items={data.topLosers.slice(0, 3)}
          type="loser"
        />
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  valueColor,
  secondary,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  valueColor?: string;
  secondary?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg px-4 py-3"
      style={{
        background: "var(--bg-muted)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span style={{ color: "var(--text-muted)" }}>{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className="text-lg font-bold tabular-nums"
          style={{ color: valueColor || "var(--text-primary)" }}
        >
          {value}
        </span>
        {secondary}
      </div>
    </div>
  );
}

function CategoryCard({
  code,
  name,
  description,
  icon,
  fundCount,
  dailyReturn,
}: {
  code: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  fundCount: number;
  dailyReturn: number;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      href={`/sectors?sector=${code}`}
      className="group relative rounded-lg px-4 py-3 transition-all"
      style={{
        background: hovered ? "var(--bg-hover)" : "var(--bg-muted)",
        border: "1px solid var(--border-subtle)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-md flex-shrink-0"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-base leading-tight" style={{ color: "var(--text-primary)" }}>
            {name}
          </h3>
          <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--text-muted)" }}>
            {description}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-2xs font-medium" style={{ color: "var(--text-tertiary)" }}>
              {fundCount} fon
            </span>
            {hovered && (
              <span
                className="text-2xs font-semibold tabular-nums"
                style={{ color: dailyReturn >= 0 ? "var(--success)" : "var(--danger)" }}
              >
                {dailyReturn >= 0 ? "+" : ""}{dailyReturn.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function MiniPerformanceList({
  title,
  items,
  type,
}: {
  title: string;
  items: Array<{
    code: string;
    name: string;
    shortName: string | null;
    dailyReturn: number;
  }>;
  type: "gainer" | "loser";
}) {
  const isGainer = type === "gainer";
  const color = isGainer ? "var(--success)" : "var(--danger)";

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: "var(--bg-muted)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center gap-2">
          {isGainer ? (
            <TrendingUp className="h-3.5 w-3.5" style={{ color }} />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" style={{ color }} />
          )}
          <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
            {title}
          </span>
        </div>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
        {items.length === 0 ? (
          <div className="px-4 py-3 text-xs leading-snug" style={{ color: "var(--text-muted)" }}>
            Günlük getiri henüz yok veya tüm fonlar değişimsiz görünüyor. TEFAS’tan güncel veri çekildikten
            sonra dolar.
          </div>
        ) : (
          items.map((item, i) => (
            <div
              key={item.code}
              className="flex items-center justify-between px-4 py-2 transition-colors hover:bg-[var(--bg-hover)]"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="text-2xs font-bold tabular-nums w-4 text-center"
                  style={{ color: "var(--text-muted)" }}
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <span className="font-semibold text-xs" style={{ color: "var(--text-primary)" }}>
                    {item.code}
                  </span>
                  <span className="text-2xs ml-1.5 truncate" style={{ color: "var(--text-muted)" }}>
                    {item.shortName || item.name.slice(0, 20)}
                  </span>
                </div>
              </div>
              <span className="font-semibold text-xs tabular-nums" style={{ color }}>
                {isGainer ? "+" : ""}{item.dailyReturn.toFixed(2)}%
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

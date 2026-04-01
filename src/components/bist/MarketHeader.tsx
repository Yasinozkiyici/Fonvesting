"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, BarChart3, Activity, DollarSign, Layers } from "lucide-react";

interface MarketData {
  bist100: {
    value: number;
    change: number;
    changePercent: number;
  } | null;
  totalMarketCap: number;
  totalTurnover: number;
  stockCount: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  usdTry: number | null;
  eurTry: number | null;
  topGainers: Stock[];
  topLosers: Stock[];
  formatted: {
    totalMarketCap: string;
    totalTurnover: string;
  };
}

interface Stock {
  symbol: string;
  name: string;
  shortName: string | null;
  lastPrice: number;
  changePercent: number;
}

interface Sector {
  id: string;
  code: string;
  name: string;
  color: string | null;
  stockCount: number;
  avgChange: number;
}

export default function MarketHeader() {
  const [data, setData] = useState<MarketData | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/market").then((r) => r.json()),
      fetch("/api/sectors").then((r) => r.json()),
    ])
      .then(([marketData, sectorsData]) => {
        setData(marketData);
        setSectors(sectorsData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="hero-card p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="skeleton h-12 w-12 rounded-xl" />
              <div className="space-y-2">
                <div className="skeleton h-3 w-16" />
                <div className="skeleton h-8 w-40" />
              </div>
            </div>
            <div className="flex gap-8">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="skeleton h-3 w-14" />
                  <div className="skeleton h-5 w-20" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card p-5 space-y-3">
              <div className="skeleton h-4 w-28" />
              <div className="space-y-2">
                {[...Array(4)].map((_, j) => (
                  <div key={j} className="skeleton h-9 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const isPositive = (data.bist100?.changePercent ?? 0) >= 0;
  return (
    <div className="space-y-5">
      {/* Hero Card - BIST 100 Index */}
      <div className="hero-card">
        <div className="p-5 md:p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            {/* Left: Primary Index Display */}
            <div className="flex items-center gap-4">
              {/* Icon */}
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: isPositive 
                    ? 'var(--success-bg)' 
                    : 'var(--danger-bg)',
                  border: `1px solid ${isPositive ? 'var(--success-border)' : 'var(--danger-border)'}`,
                }}
              >
                {isPositive ? (
                  <TrendingUp className="w-5 h-5" style={{ color: 'var(--success)' }} />
                ) : (
                  <TrendingDown className="w-5 h-5" style={{ color: 'var(--danger)' }} />
                )}
              </div>
              
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-caption">BIST 100</span>
                  <span 
                    className="px-2 py-0.5 text-[10px] font-semibold rounded-full"
                    style={{
                      background: 'var(--bg-hover)',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    ENDEKS
                  </span>
                </div>
                
                <div className="flex items-center gap-4">
                  <span className="text-display text-mono" style={{ color: 'var(--text-primary)' }}>
                    {data.bist100?.value.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                  </span>
                  <div className={isPositive ? 'change-positive' : 'change-negative'}>
                    {isPositive ? (
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5" />
                    )}
                    <span className="text-mono text-sm">
                      {isPositive ? "+" : ""}{data.bist100?.changePercent.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="hidden lg:block divider-v" />

            {/* Right: Secondary Metrics */}
            <div className="flex flex-wrap items-center gap-6 lg:gap-8">
              <StatBlock 
                icon={<BarChart3 className="w-4 h-4" />}
                label="Piyasa Değeri"
                value={data.formatted.totalMarketCap}
              />
              <StatBlock 
                icon={<Activity className="w-4 h-4" />}
                label="İşlem Hacmi"
                value={data.formatted.totalTurnover}
              />
              <StatBlock 
                icon={<DollarSign className="w-4 h-4" />}
                label="USD/TRY"
                value={data.usdTry?.toFixed(4) ?? "-"}
                mono
              />

              {/* Divider */}
              <div className="hidden md:block divider-v" />

              {/* Market Mood */}
              <div className="flex items-center gap-2">
                <div className="badge badge-success">
                  <TrendingUp className="w-3 h-3" />
                  <span className="tabular-nums font-bold">{data.advancers}</span>
                </div>
                <div className="badge badge-danger">
                  <TrendingDown className="w-3 h-3" />
                  <span className="tabular-nums font-bold">{data.decliners}</span>
                </div>
                <div className="badge badge-neutral">
                  <span className="tabular-nums font-bold">{data.unchanged}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Top Gainers */}
        <MoverCard 
          title="En Çok Yükselen"
          icon={<TrendingUp className="w-4 h-4" />}
          items={data.topGainers.slice(0, 4)}
          type="gainer"
        />

        {/* Top Losers */}
        <MoverCard 
          title="En Çok Düşen"
          icon={<TrendingDown className="w-4 h-4" />}
          items={data.topLosers.slice(0, 4)}
          type="loser"
        />

        {/* Sectors */}
        <div className="card card-hover">
          <div className="p-4">
            <div className="flex items-center gap-2.5 mb-4">
              <div 
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{
                  background: 'var(--accent-bg)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <Layers className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              </div>
              <h3 className="text-title" style={{ color: 'var(--text-primary)' }}>Sektörler</h3>
            </div>
            <div className="space-y-0.5">
              {sectors.slice(0, 4).map((sector, i) => {
                const isUp = sector.avgChange >= 0;
                return (
                  <div 
                    key={sector.id} 
                    className="flex items-center justify-between py-2.5 px-2.5 rounded-lg transition-colors cursor-pointer"
                    style={{ background: 'transparent' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div className="flex items-center gap-2.5">
                      <span 
                        className="w-5 text-xs font-medium tabular-nums"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {i + 1}
                      </span>
                      <div 
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                        style={{
                          background: 'var(--bg-hover)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {sector.code.slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {sector.name}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {sector.stockCount} hisse
                        </p>
                      </div>
                    </div>
                    <span 
                      className="text-sm font-semibold tabular-nums"
                      style={{ color: isUp ? 'var(--success)' : 'var(--danger)' }}
                    >
                      {isUp ? "+" : ""}{sector.avgChange.toFixed(2)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBlock({ 
  icon, 
  label, 
  value, 
  mono = false 
}: { 
  icon: React.ReactNode; 
  label: string; 
  value: string; 
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div 
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{
          background: 'var(--bg-hover)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-muted)',
        }}
      >
        {icon}
      </div>
      <div className="stat-block">
        <span className="stat-label">{label}</span>
        <span className={`stat-value ${mono ? 'font-mono' : ''}`}>{value}</span>
      </div>
    </div>
  );
}

function MoverCard({ 
  title, 
  icon, 
  items, 
  type 
}: { 
  title: string;
  icon: React.ReactNode;
  items: Stock[];
  type: 'gainer' | 'loser';
}) {
  const color = type === 'gainer' ? 'var(--success)' : 'var(--danger)';
  const bg = type === 'gainer' ? 'var(--success-bg)' : 'var(--danger-bg)';
  
  return (
    <div className="card card-hover">
      <div className="p-4">
        <div className="flex items-center gap-2.5 mb-4">
          <div 
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: bg,
              border: `1px solid ${type === 'gainer' ? 'var(--success-border)' : 'var(--danger-border)'}`,
              color: color,
            }}
          >
            {icon}
          </div>
          <h3 className="text-title" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        </div>
        <div className="space-y-0.5">
          {items.map((stock, i) => (
            <div 
              key={stock.symbol} 
              className="flex items-center justify-between py-2.5 px-2.5 rounded-lg transition-colors cursor-pointer"
              style={{ background: 'transparent' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <div className="flex items-center gap-2.5">
                <span 
                  className="w-5 text-xs font-medium tabular-nums"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {i + 1}
                </span>
                <div 
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                  style={{
                    background: bg,
                    border: `1px solid ${type === 'gainer' ? 'var(--success-border)' : 'var(--danger-border)'}`,
                    color: color,
                  }}
                >
                  {stock.symbol.slice(0, 2)}
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {stock.symbol}
                  </p>
                  <p 
                    className="text-xs truncate max-w-[90px]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {stock.shortName || stock.name}
                  </p>
                </div>
              </div>
              <span 
                className="text-sm font-semibold tabular-nums"
                style={{ color }}
              >
                {type === 'gainer' ? "+" : ""}{stock.changePercent.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

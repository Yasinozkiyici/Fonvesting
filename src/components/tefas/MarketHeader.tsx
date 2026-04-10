"use client";

import { ArrowRight } from "lucide-react";
import { normalizeMarketApi, type MarketApiPayload } from "@/lib/client-data";

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

export default function MarketHeader({
  initialData,
}: {
  initialData?: MarketApiPayload | null;
}) {
  const data = normalizeMarketApi(initialData);
  if (!data) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Piyasa özeti şu an yüklenemiyor. Veri bağlantısı geldiğinde otomatik düzelir.
      </p>
    );
  }

  const avg1g = data.summary.avgDailyReturn;
  const avg1gStr = `${avg1g >= 0 ? "+" : ""}${avg1g.toFixed(2)}%`;

  return (
    <section className="space-y-3 sm:space-y-3.5">
      <div className="ds-hero-compact">
        <div className="ds-hero-compact__intro">
          <h1 className="ds-hero-title tracking-[-0.035em]">
            Fonları daha net keşfet, karşılaştır ve filtrele
          </h1>
          <p className="hero-lede mt-1.5 max-w-[42rem] text-[12.5px] leading-snug sm:text-[13.5px]" style={{ color: "var(--text-secondary)" }}>
            Karışık fon verisini sade bir keşif akışına çevirir; karşılaştırma ve filtre kararlarını netleştirir.
          </p>
          <a
            href="#funds-table"
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium tracking-[-0.01em] transition-colors hover:border-[var(--border-strong)] sm:px-3.5 sm:text-[12px]"
            style={{
              borderColor: "var(--border-default)",
              color: "var(--text-secondary)",
              background: "var(--card-bg)",
            }}
          >
            Tabloya git
            <ArrowRight className="h-3 w-3" strokeWidth={2} aria-hidden />
          </a>
        </div>

        <div
          className="ds-hero-stats market-snapshot-bar-compact"
          role="group"
          aria-label="Piyasa metrikleri"
        >
          <div className="market-snapshot-item-sm">
            <span className="market-snapshot-k-sm">Toplam portföy</span>
            <span className="market-snapshot-v-sm tabular-nums">{formatFullTl(data.totalPortfolioSize)}</span>
          </div>
          <span className="market-snapshot-sep-sm" aria-hidden />
          <div className="market-snapshot-item-sm">
            <span className="market-snapshot-k-sm">Yatırımcı</span>
            <span className="market-snapshot-v-sm tabular-nums">{formatFullInteger(data.totalInvestorCount)}</span>
          </div>
          <span className="market-snapshot-sep-sm" aria-hidden />
          <div className="market-snapshot-item-sm">
            <span className="market-snapshot-k-sm">Fon</span>
            <span className="market-snapshot-v-sm tabular-nums">{data.fundCount.toLocaleString("tr-TR")}</span>
          </div>
          <span className="market-snapshot-sep-sm" aria-hidden />
          <div className="market-snapshot-item-sm">
            <span className="market-snapshot-k-sm">Ort. 1G</span>
            <span
              className={`market-snapshot-v-sm tabular-nums ${avg1g >= 0 ? "market-snapshot-v--pos" : "market-snapshot-v--neg"}`}
            >
              {avg1gStr}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

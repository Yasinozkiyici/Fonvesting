"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { normalizeMarketApi, type MarketApiPayload } from "@/lib/client-data";
import { describeHomeMarketFundCell } from "@/lib/home-market-fund-stats";

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

function formatFx(n: number | null | undefined) {
  if (!Number.isFinite(Number(n))) return null;
  return Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function SnapshotSep() {
  return <span className="market-snapshot-sep-sm shrink-0" aria-hidden />;
}

export default function MarketHeader({
  initialData,
  /** Tablo / skor API `total` ile aynı keşif evreni; portföy özeti fon sayısından farklı olabilir */
  exploreUniverseTotal,
}: {
  initialData?: MarketApiPayload | null;
  exploreUniverseTotal?: number | null;
}) {
  const data = normalizeMarketApi(initialData);
  if (!data) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Piyasa özeti şu an yüklenemiyor. Veri bağlantısı geldiğinde otomatik düzelir.
      </p>
    );
  }

  const usdTryStr = formatFx(data.usdTry);
  const fundCell = describeHomeMarketFundCell({
    snapshotFundCount: data.fundCount,
    exploreUniverseTotal,
  });

  return (
    <section className="space-y-1 sm:space-y-2">
      <div className="max-w-[42rem]">
        <h1 className="ds-hero-title !mt-0 tracking-[-0.035em]">Yatırım fonları</h1>
        <p
          className="hero-lede mt-0.5 hidden max-w-[36rem] text-[11px] leading-snug sm:block sm:text-[12px]"
          style={{ color: "var(--text-secondary)" }}
        >
          Keşif rotanızı seçin; tüm evreni tabloda süzün ve sıralayın.
        </p>
      </div>

      <div
        className="ds-hero-stats market-snapshot-bar-compact market-pulse-micro !mt-0 sm:!mt-0.5"
        role="group"
        aria-label="Piyasa nabzı — bağlam özeti"
      >
        <div className="market-snapshot-item-sm py-0">
          <span className="market-snapshot-k-sm">Toplam portföy</span>
          <span className="market-snapshot-v-sm market-snapshot-v--truncate">{formatFullTl(data.totalPortfolioSize)}</span>
        </div>
        <SnapshotSep />
        <div className="market-snapshot-item-sm py-0">
          <span className="market-snapshot-k-sm">Yatırımcı</span>
          <span className="market-snapshot-v-sm">{formatFullInteger(data.totalInvestorCount)}</span>
        </div>
        <SnapshotSep />
        <div className="market-snapshot-item-sm min-w-[4.75rem] max-w-[7rem] py-0" title={fundCell.fullDescription}>
          <span className="market-snapshot-k-sm">{fundCell.primaryLabel}</span>
          <span className="market-snapshot-v-sm leading-tight">{fundCell.primaryValue}</span>
          {fundCell.secondaryLine ? (
            <span
              className="mt-0.5 block max-w-[6.5rem] truncate text-[7.5px] font-medium leading-tight sm:text-[8px]"
              style={{ color: "var(--text-tertiary)" }}
              title={fundCell.fullDescription}
            >
              {fundCell.secondaryLine}
            </span>
          ) : null}
        </div>
        {usdTryStr ? (
          <>
            <SnapshotSep />
            <div className="market-snapshot-item-sm py-0">
              <span className="market-snapshot-k-sm">USD/TRY</span>
              <span className="market-snapshot-v-sm">{usdTryStr}</span>
            </div>
          </>
        ) : null}
        <SnapshotSep />
        <div className="market-snapshot-item-sm min-w-[5.25rem] max-w-[8rem] flex-1 py-0 sm:min-w-[5.75rem]">
          <span className="market-snapshot-k-sm">Yön dağılımı</span>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0 text-[9.5px] font-semibold tabular-nums leading-none sm:text-[10px]">
            <span className="inline-flex items-center gap-0.5" style={{ color: "var(--success-muted)" }}>
              <ArrowUpRight className="h-2.5 w-2.5 shrink-0 sm:h-3 sm:w-3" strokeWidth={2.2} aria-hidden />
              {data.advancers.toLocaleString("tr-TR")}
            </span>
            <span className="inline-flex items-center gap-0.5" style={{ color: "var(--danger-muted)" }}>
              <ArrowDownRight className="h-2.5 w-2.5 shrink-0 sm:h-3 sm:w-3" strokeWidth={2.2} aria-hidden />
              {data.decliners.toLocaleString("tr-TR")}
            </span>
            <span className="inline-flex items-center gap-0.5" style={{ color: "var(--text-tertiary)" }}>
              <Minus className="h-2.5 w-2.5 shrink-0 sm:h-3 sm:w-3" strokeWidth={2.2} aria-hidden />
              {data.unchanged.toLocaleString("tr-TR")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

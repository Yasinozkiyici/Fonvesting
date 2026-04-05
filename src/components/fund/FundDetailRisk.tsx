import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits).replace(".", ",")}%`;
}

type StatProps = { label: string; value: string; hint?: string };

function Stat({ label, value, hint }: StatProps) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="mt-1.5 tabular-nums text-sm font-semibold tracking-[-0.02em] sm:text-[15px]" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[11px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Props = { data: FundDetailPageData };

export function FundDetailRisk({ data }: Props) {
  const m = data.historyMetrics ?? data.snapshotMetrics;
  const bw = data.bestWorstDay;
  const d = data.derivedSummary;

  const hasVol = m && Number.isFinite(m.volatility) && m.volatility > 0;
  const hasDd = m && Number.isFinite(m.maxDrawdown) && m.maxDrawdown > 0;
  const hasDay = bw && (Number.isFinite(bw.bestPct) || Number.isFinite(bw.worstPct));
  const has1y = d.returnApprox1YearPct != null && Number.isFinite(d.returnApprox1YearPct);
  const hasRoll =
    d.bestRollingMonthPct != null &&
    d.worstRollingMonthPct != null &&
    Number.isFinite(d.bestRollingMonthPct) &&
    Number.isFinite(d.worstRollingMonthPct);
  const hasWin = m && Number.isFinite(m.winRate) && m.dataPoints >= 20 && m.winRate > 0;

  if (!hasVol && !hasDd && !hasDay && !has1y && !hasRoll && !hasWin) return null;

  return (
    <section aria-labelledby="fund-detail-risk-heading">
      <FundDetailSectionTitle id="fund-detail-risk-heading">Risk ve dönem özeti</FundDetailSectionTitle>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed sm:text-sm" style={{ color: "var(--text-secondary)" }}>
        Fiyat geçmişinden türetilen özetler; yatırım tavsiyesi değildir.
      </p>
      <div
        className="mt-4 grid gap-x-6 gap-y-7 rounded-xl border px-4 py-5 sm:grid-cols-2 sm:px-6 sm:py-6 lg:grid-cols-3"
        style={{ borderColor: "var(--border-subtle)", background: "var(--card-bg)" }}
      >
        {has1y ? (
          <Stat
            label="Yaklaşık 1Y getiri"
            value={fmtPct(d.returnApprox1YearPct!, 2)}
            hint="~365 gün veya mevcut serinin başı; takvim bazlı."
          />
        ) : null}
        {hasRoll ? (
          <Stat
            label="~21 gün penceresi"
            value={`${fmtPct(d.bestRollingMonthPct!, 1)} / ${fmtPct(d.worstRollingMonthPct!, 1)}`}
            hint="Ardışık işlem günleri içinde en iyi ve en zayıf dilim."
          />
        ) : null}
        {hasVol ? (
          <Stat label="Yıllıklandırılmış volatilite" value={fmtPct(m!.volatility, 1)} hint="Geçmiş getiri dalgalanması." />
        ) : null}
        {hasDd ? (
          <Stat label="Maks. düşüş (drawdown)" value={fmtPct(m!.maxDrawdown, 1)} hint="Zirveden en derin geri çekilme." />
        ) : null}
        {hasWin ? (
          <Stat
            label="Pozitif gün payı"
            value={fmtPct(m!.winRate, 0)}
            hint="Kayıtlı günlük getirilerde pozitif kapanış oranı."
          />
        ) : null}
        {hasDay && bw ? (
          <Stat label="En güçlü 1G" value={fmtPct(bw.bestPct, 2)} hint="Tek günlük hareketler içinde." />
        ) : null}
        {hasDay && bw ? (
          <Stat label="En zayıf 1G" value={fmtPct(bw.worstPct, 2)} hint="Tek günlük hareketler içinde." />
        ) : null}
      </div>
    </section>
  );
}

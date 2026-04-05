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
      <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="mt-1 tabular-nums text-sm font-semibold tracking-[-0.02em] sm:text-[15px]" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
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

  const hasVol = m && Number.isFinite(m.volatility) && m.volatility > 0;
  const hasDd = m && Number.isFinite(m.maxDrawdown) && m.maxDrawdown > 0;
  const hasDay = bw && (Number.isFinite(bw.bestPct) || Number.isFinite(bw.worstPct));

  if (!hasVol && !hasDd && !hasDay) return null;

  return (
    <section className="mt-8 sm:mt-10" aria-labelledby="fund-detail-risk-heading">
      <FundDetailSectionTitle id="fund-detail-risk-heading">Risk ve dönem özeti</FundDetailSectionTitle>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        Aşağıdaki göstergeler, mevcut fiyat geçmişine dayalı teknik özetlerdir; yatırım tavsiyesi değildir.
      </p>
      <div
        className="mt-4 grid gap-6 rounded-xl border px-4 py-5 sm:grid-cols-2 sm:gap-8 sm:px-6 lg:grid-cols-4"
        style={{ borderColor: "var(--border-subtle)", background: "var(--card-bg)" }}
      >
        {hasVol ? (
          <Stat
            label="Yıllıklandırılmış volatilite"
            value={fmtPct(m!.volatility, 1)}
            hint="Geçmiş getiri dalgalanması."
          />
        ) : null}
        {hasDd ? (
          <Stat
            label="Maks. düşüş (drawdown)"
            value={fmtPct(m!.maxDrawdown, 1)}
            hint="Zirveden en derin geri çekilme."
          />
        ) : null}
        {hasDay && bw ? (
          <Stat
            label="En güçlü 1G"
            value={fmtPct(bw.bestPct, 2)}
            hint="Kayıtlı günlük getiriler içinde."
          />
        ) : null}
        {hasDay && bw ? (
          <Stat
            label="En zayıf 1G"
            value={fmtPct(bw.worstPct, 2)}
            hint="Kayıtlı günlük getiriler içinde."
          />
        ) : null}
      </div>
    </section>
  );
}

import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import { MobileDetailAccordion } from "@/components/fund/MobileDetailAccordion";
import { formatDetailRiskPercent } from "@/lib/fund-detail-format";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

type StatProps = { label: string; value: string };

function Stat({ label, value }: StatProps) {
  return (
    <div
      className="flex min-h-[5.1rem] min-w-0 flex-col justify-between rounded-[0.9rem] border px-3 py-2.5 shadow-[var(--shadow-xs)] sm:min-h-[5.25rem] sm:px-3.5 sm:py-2.75"
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 72%, transparent)",
        background: "linear-gradient(165deg, color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted)), color-mix(in srgb, var(--card-bg) 90%, var(--bg-muted)))",
      }}
    >
      <p className="text-[9px] font-semibold uppercase tracking-[0.11em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="mt-1 tabular-nums text-[1.08rem] font-semibold tracking-[-0.038em] sm:mt-1.5 sm:text-[1.12rem]" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}

type Props = { data: FundDetailPageData };

export function FundDetailRisk({ data }: Props) {
  const m = data.historyMetrics ?? data.snapshotMetrics;
  const d = data.derivedSummary;

  const hasVol = m && Number.isFinite(m.volatility) && m.volatility > 0;
  const hasDd = m && Number.isFinite(m.maxDrawdown) && m.maxDrawdown > 0;
  const has1y = d.returnApprox1YearPct != null && Number.isFinite(d.returnApprox1YearPct);
  const has3y = d.returnApprox3YearPct != null && Number.isFinite(d.returnApprox3YearPct);

  if (!hasVol && !hasDd && !has1y && !has3y) return null;

  const content = (
    <div
      className="grid gap-2 rounded-[1.05rem] border px-3 py-2.5 sm:grid-cols-2 sm:gap-2.5 sm:px-3.5 sm:py-3 lg:grid-cols-4"
      style={{
        borderColor: "var(--border-subtle)",
        background: "var(--card-bg)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      {has1y ? (
        <Stat label="Yaklaşık 1Y getiri" value={formatDetailRiskPercent(d.returnApprox1YearPct!, 2)} />
      ) : null}
      {has3y ? (
        <Stat label="Yaklaşık 3Y getiri" value={formatDetailRiskPercent(d.returnApprox3YearPct!, 2)} />
      ) : null}
      {hasVol ? (
        <Stat label="Oynaklık (yıllık)" value={formatDetailRiskPercent(m!.volatility, 1)} />
      ) : null}
      {hasDd ? (
        <Stat label="En derin düşüş" value={formatDetailRiskPercent(m!.maxDrawdown, 1)} />
      ) : null}
    </div>
  );

  return (
    <>
      <div className="md:hidden">
        <MobileDetailAccordion
          title="Risk Özeti"
          hint="Getiri, oynaklık ve geri çekilme görünümünü tek bakışta özetler."
          defaultOpen
        >
          {content}
        </MobileDetailAccordion>
      </div>

      <section aria-labelledby="fund-detail-risk-heading" className="hidden md:block">
        <div className="flex items-end justify-between gap-4">
          <div>
            <FundDetailSectionTitle id="fund-detail-risk-heading">Risk Özeti</FundDetailSectionTitle>
            <p className="mt-1.5 text-[12px] leading-relaxed sm:text-[13px]" style={{ color: "var(--text-tertiary)" }}>
              Oynaklık ve geri çekilme ile yakın/orta vade getiri özeti.
            </p>
          </div>
        </div>
        <div className="mt-2">{content}</div>
      </section>
    </>
  );
}

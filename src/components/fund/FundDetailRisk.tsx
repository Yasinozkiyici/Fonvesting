import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import { MobileDetailAccordion } from "@/components/fund/MobileDetailAccordion";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits).replace(".", ",")}%`;
}

type StatProps = { label: string; value: string };

function Stat({ label, value }: StatProps) {
  return (
    <div
      className="flex min-h-[5.8rem] min-w-0 flex-col justify-between rounded-[0.95rem] border px-3 py-2.5"
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 86%, transparent)",
        background: "color-mix(in srgb, var(--card-bg) 94%, var(--bg-muted))",
      }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.09em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="mt-2.5 tabular-nums text-[16px] font-semibold tracking-[-0.03em] sm:text-[1.05rem]" style={{ color: "var(--text-primary)" }}>
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
      className="grid gap-2.5 rounded-[1.05rem] border px-3 py-3 sm:grid-cols-2 sm:px-3.5 sm:py-3.5 lg:grid-cols-4"
      style={{
        borderColor: "var(--border-subtle)",
        background: "var(--card-bg)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      {has1y ? (
        <Stat label="Yaklaşık 1Y getiri" value={fmtPct(d.returnApprox1YearPct!, 2)} />
      ) : null}
      {has3y ? (
        <Stat label="Yaklaşık 3Y getiri" value={fmtPct(d.returnApprox3YearPct!, 2)} />
      ) : null}
      {hasVol ? (
        <Stat label="Oynaklık (yıllık)" value={fmtPct(m!.volatility, 1)} />
      ) : null}
      {hasDd ? (
        <Stat label="En derin düşüş" value={fmtPct(m!.maxDrawdown, 1)} />
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
            <p className="mt-1 text-[12px] leading-snug sm:text-[13px]" style={{ color: "var(--text-secondary)" }}>
              Getiri, oynaklık ve geri çekilme görünümünü tek bakışta özetler.
            </p>
          </div>
        </div>
        <div className="mt-2">{content}</div>
      </section>
    </>
  );
}

import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import { MobileDetailAccordion } from "@/components/fund/MobileDetailAccordion";
import { formatDetailRiskPercent } from "@/lib/fund-detail-format";
import { deriveFundDetailSectionStates } from "@/lib/fund-detail-section-status";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

const MAX_PLAUSIBLE_VOLATILITY_PCT = 250;
const MAX_PLAUSIBLE_DRAWDOWN_PCT = 100;

function isPlausibleVolatility(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_PLAUSIBLE_VOLATILITY_PCT;
}

function isPlausibleDrawdown(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_PLAUSIBLE_DRAWDOWN_PCT;
}

/** Mobil sekme / sayfa sarmalayıcı — boş risk bloğu göstermemek için */
export function fundDetailRiskSectionHasContent(data: FundDetailPageData): boolean {
  return deriveFundDetailSectionStates(data).risk !== "no_data";
}

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
      <p className="text-[9px] font-semibold uppercase tracking-[0.11em]" style={{ color: "var(--text-secondary)" }}>
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
  const riskState = deriveFundDetailSectionStates(data).risk;
  const m = data.historyMetrics ?? data.snapshotMetrics;
  const d = data.derivedSummary;

  const hasVol = isPlausibleVolatility(m?.volatility);
  const hasDd = isPlausibleDrawdown(m?.maxDrawdown);
  const has1y = d.returnApprox1YearPct != null && Number.isFinite(d.returnApprox1YearPct);
  const has3y = d.returnApprox3YearPct != null && Number.isFinite(d.returnApprox3YearPct);
  const hasAny = hasVol || hasDd || has1y || has3y;

  if (!hasAny) {
    const fallbackContent = (
      <div
        className="rounded-[1.05rem] border px-3 py-2.5 sm:px-3.5 sm:py-3"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--card-bg)",
          boxShadow: "var(--shadow-xs)",
        }}
      >
        <p className="text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Risk özeti şu an üretilemiyor
        </p>
        <p className="mt-1 text-[10.5px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
          Bu fon için güvenilir risk verisi henüz yok.
        </p>
      </div>
    );
    return (
      <div data-detail-section="risk" className="scroll-mt-28 md:scroll-mt-0">
        <div className="md:hidden">
          <MobileDetailAccordion
            title="Risk Özeti"
            hint="Getiri, oynaklık ve geri çekilme görünümünü tek bakışta özetler."
            defaultOpen={false}
          >
            {fallbackContent}
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
            <span
              className="inline-flex items-center rounded-full border px-2.5 py-[0.3rem] text-[9px] font-semibold uppercase tracking-[0.08em]"
              style={{
                borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
                color: "var(--text-muted)",
                background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
              }}
            >
              Risk: Veri yok
            </span>
          </div>
          <div className="mt-2">{fallbackContent}</div>
        </section>
      </div>
    );
  }

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
    <div data-detail-section="risk" className="scroll-mt-28 md:scroll-mt-0">
      <div className="md:hidden">
        <MobileDetailAccordion
          title="Risk Özeti"
          hint="Getiri, oynaklık ve geri çekilme görünümünü tek bakışta özetler."
          defaultOpen={false}
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
          <span
            className="inline-flex items-center rounded-full border px-2.5 py-[0.3rem] text-[9px] font-semibold uppercase tracking-[0.08em]"
            style={{
              borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
              color: riskState === "full" ? "var(--success-muted)" : "var(--text-tertiary)",
              background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
            }}
          >
            {riskState === "full" ? "Risk: Tam" : riskState === "partial" ? "Risk: Kısmi" : "Risk: Veri yok"}
          </span>
        </div>
        <div className="mt-2">{content}</div>
      </section>
    </div>
  );
}

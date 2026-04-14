import { RiskBadge } from "@/components/tefas/ScoringComponents";
import { MobileDetailAccordion } from "@/components/fund/MobileDetailAccordion";
import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import { formatDetailSignedPercent } from "@/lib/fund-detail-format";
import { fundTypeDisplayLabel } from "@/lib/fund-type-display";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

type RowProps = { label: string; hint?: string; children: React.ReactNode };

function ProfileRow({ label, hint, children }: RowProps) {
  return (
    <div
      className="fund-detail-profile-row-sep flex flex-col gap-1 border-b border-[color-mix(in_srgb,var(--border-subtle)_48%,transparent)] py-2 last:border-b-0 lg:grid lg:grid-cols-[minmax(0,9.25rem)_minmax(0,1fr)] lg:items-start lg:gap-5 lg:py-2.5"
    >
      <div className="min-w-0 lg:pt-0.5">
        <div className="text-[10px] font-semibold uppercase sm:text-[10.5px]" style={{ color: "var(--text-muted)", letterSpacing: "0.07em" }}>
          {label}
        </div>
        {hint ? (
          <p className="mt-0.5 max-w-[30ch] text-[10px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
            {hint}
          </p>
        ) : null}
      </div>
      <div className="min-w-0 text-[13px] font-semibold leading-snug sm:text-[13.5px]" style={{ color: "var(--text-primary)" }}>
        {children}
      </div>
    </div>
  );
}

function ReturnCapsule({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span
      className="inline-flex min-h-[1.6rem] items-center gap-1.5 rounded-[0.65rem] border px-2 py-[0.26rem]"
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 70%, transparent)",
        background: "color-mix(in srgb, var(--bg-muted) 35%, var(--card-bg))",
      }}
    >
      <span className="text-[8.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span className="text-[10.5px] font-semibold tabular-nums tracking-[-0.018em]" style={{ color: "var(--text-primary)" }}>
        {value}
      </span>
    </span>
  );
}

function fmtTefasReturn(v: number): React.ReactNode {
  const text = formatDetailSignedPercent(v, { maxAbs: 1000 });
  if (text === "—") return <span style={{ color: "var(--text-muted)" }}>—</span>;
  const num = Number(v);
  const pos = num > 0;
  const zero = num === 0;
  return (
    <span className="tabular-nums font-semibold tracking-[-0.02em]" style={{ color: zero ? "var(--text-secondary)" : pos ? "var(--success)" : "var(--danger)" }}>
      {text}
    </span>
  );
}

function formatDateTr(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = { data: FundDetailPageData };

export function FundDetailProfile({ data }: Props) {
  const { fund, riskLevel, snapshotDate, tradingCurrency } = data;
  const typeLabel = fundTypeDisplayLabel(fund.fundType);

  const lastSyncLabel = fund.lastUpdatedAt ?? fund.updatedAt;
  const content = (
    <div
      className="rounded-[1.05rem] border px-3.5 py-2.5 sm:px-4 sm:py-3"
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 78%, transparent)",
        background: "var(--card-bg)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      <div>
        {typeLabel !== "—" ? <ProfileRow label="Fon türü">{typeLabel}</ProfileRow> : null}
        {fund.category ? <ProfileRow label="Kategori">{fund.category.name}</ProfileRow> : null}
        <ProfileRow label="Portföy yöneticisi">
          {fund.portfolioManagerInferred ? (
            <span className="line-clamp-2 break-words">{fund.portfolioManagerInferred}</span>
          ) : (
            <span style={{ color: "var(--text-tertiary)" }}>Veri bulunamadı</span>
          )}
        </ProfileRow>
        <ProfileRow label="İşlem para birimi">
          {tradingCurrency}
        </ProfileRow>
        {!snapshotDate ? (
          <ProfileRow label="Son güncelleme">
            <span className="tabular-nums text-[13px]" style={{ color: "var(--text-secondary)" }}>
              {formatDateTr(lastSyncLabel)}
            </span>
          </ProfileRow>
        ) : null}
        <ProfileRow label="Getiri özeti" hint="Kısa ve orta vade TEFAS özet getirileri.">
          <span
            className="inline-flex max-w-full flex-wrap gap-1.5 rounded-[0.75rem] px-1 py-1 sm:max-w-[min(100%,28rem)] sm:px-1.5 sm:py-1.5"
            style={{ background: "color-mix(in srgb, var(--bg-muted) 42%, var(--card-bg))" }}
          >
            <ReturnCapsule label="1H" value={fmtTefasReturn(fund.weeklyReturn)} />
            <ReturnCapsule label="1A" value={fmtTefasReturn(fund.monthlyReturn)} />
            <ReturnCapsule label="1Y" value={fmtTefasReturn(fund.yearlyReturn)} />
            <ReturnCapsule label="3Y" value={fmtTefasReturn(data.derivedSummary.returnApprox3YearPct ?? Number.NaN)} />
          </span>
        </ProfileRow>
        {riskLevel ? (
          <ProfileRow label="Risk seviyesi">
            <span
              className="inline-flex items-center rounded-[0.7rem] border px-2 py-[0.34rem] shadow-[var(--shadow-xs)]"
              style={{
                borderColor: "color-mix(in srgb, var(--border-subtle) 65%, transparent)",
                background: "color-mix(in srgb, var(--card-bg) 88%, var(--bg-muted))",
              }}
            >
              <RiskBadge level={riskLevel} />
            </span>
          </ProfileRow>
        ) : null}
        {snapshotDate ? (
          <ProfileRow label="Veri tarihi">
            <span className="tabular-nums text-[13px]" style={{ color: "var(--text-secondary)" }}>
              {new Date(snapshotDate).toLocaleDateString("tr-TR", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </ProfileRow>
        ) : null}
      </div>
      {fund.description && fund.description.trim().length > 0 ? (
        <div
          className="fund-detail-profile-desc-sep border-t pt-3.5 sm:pt-4"
          style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 68%, transparent)" }}
        >
          <p className="text-[10px] font-medium uppercase" style={{ color: "var(--text-muted)", letterSpacing: "0.05em" }}>
            Açıklama
          </p>
          <p
            className="mt-2 max-w-[78ch] text-[13px] leading-relaxed max-md:line-clamp-6 sm:text-sm"
            style={{ color: "var(--text-secondary)" }}
            title={fund.description.trim().length > 280 ? fund.description.trim() : undefined}
          >
            {fund.description.trim()}
          </p>
        </div>
      ) : null}
    </div>
  );

  return (
    <div data-detail-section="allocation" className="scroll-mt-28 md:scroll-mt-0">
      <div className="md:hidden">
        <MobileDetailAccordion
          title="Fon Profili"
          hint="Kimlik, risk sınıfı ve veri kapsamı."
          defaultOpen={false}
        >
          {content}
        </MobileDetailAccordion>
      </div>

      <section aria-labelledby="fund-detail-profile-heading" className="hidden md:block">
        <div>
          <FundDetailSectionTitle id="fund-detail-profile-heading">Fon Profili</FundDetailSectionTitle>
          <p className="mt-1.5 text-[12px] leading-relaxed sm:text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Kimlik, risk ve veri kapsamı tek panelde.
          </p>
        </div>
        <div className="mt-2">{content}</div>
      </section>
    </div>
  );
}

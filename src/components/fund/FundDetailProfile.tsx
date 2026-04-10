import { RiskBadge } from "@/components/tefas/ScoringComponents";
import { MobileDetailAccordion } from "@/components/fund/MobileDetailAccordion";
import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import { fundTypeDisplayLabel } from "@/lib/fund-type-display";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

type RowProps = { label: string; hint?: string; children: React.ReactNode };

function ProfileRow({ label, hint, children }: RowProps) {
  return (
    <div
      className="fund-detail-profile-row-sep flex flex-col gap-1.5 border-b py-3 last:border-b-0 lg:grid lg:grid-cols-[minmax(0,9.1rem)_minmax(0,1fr)] lg:items-start lg:gap-5 lg:py-3.5"
      style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 68%, transparent)" }}
    >
      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase sm:text-[10.5px]" style={{ color: "var(--text-muted)", letterSpacing: "0.05em" }}>
          {label}
        </div>
        {hint ? (
          <p className="mt-0.5 max-w-[26ch] text-[10px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
            {hint}
          </p>
        ) : null}
      </div>
      <div className="min-w-0 text-[13px] font-medium leading-relaxed sm:text-[13.5px]" style={{ color: "var(--text-primary)" }}>
        {children}
      </div>
    </div>
  );
}

function ReturnCapsule({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span
      className="inline-flex min-h-[1.65rem] items-center gap-1 rounded-[0.72rem] border px-1.75 py-[0.28rem]"
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 78%, transparent)",
        background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
      }}
    >
      <span className="text-[9px] font-medium uppercase" style={{ color: "var(--text-muted)", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span className="text-[10.5px] font-semibold tabular-nums tracking-[-0.015em]" style={{ color: "var(--text-primary)" }}>
        {value}
      </span>
    </span>
  );
}

function fmtTefasReturn(v: number): React.ReactNode {
  if (!Number.isFinite(v) || Math.abs(v) > 1000) {
    return <span style={{ color: "var(--text-muted)" }}>—</span>;
  }
  const pos = v > 0;
  return (
    <span className="tabular-nums font-semibold tracking-[-0.02em]" style={{ color: pos ? "var(--success)" : v < 0 ? "var(--danger)" : "var(--text-secondary)" }}>
      {pos ? "+" : ""}
      {v.toFixed(2).replace(".", ",")}%
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
        borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
        background: "var(--card-bg)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      <div>
        {typeLabel !== "—" ? <ProfileRow label="Fon türü">{typeLabel}</ProfileRow> : null}
        {fund.category ? <ProfileRow label="Kategori">{fund.category.name}</ProfileRow> : null}
        {fund.portfolioManagerInferred ? (
          <ProfileRow label="Portföy yöneticisi" hint="Fon unvanından türetilmiş özet.">
            {fund.portfolioManagerInferred}
          </ProfileRow>
        ) : null}
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
        <ProfileRow label="Getiri özeti" hint="Yakın ve orta vadeli görünüm.">
          <span className="flex flex-wrap gap-1.25">
            <ReturnCapsule label="1H" value={fmtTefasReturn(fund.weeklyReturn)} />
            <ReturnCapsule label="1A" value={fmtTefasReturn(fund.monthlyReturn)} />
            <ReturnCapsule label="1Y" value={fmtTefasReturn(fund.yearlyReturn)} />
            <ReturnCapsule label="3Y" value={fmtTefasReturn(data.derivedSummary.returnApprox3YearPct ?? Number.NaN)} />
          </span>
        </ProfileRow>
        {riskLevel ? (
          <ProfileRow label="Risk seviyesi">
            <span
              className="inline-flex items-center rounded-[0.72rem] border px-1.75 py-[0.28rem]"
              style={{
                borderColor: "color-mix(in srgb, var(--border-subtle) 80%, transparent)",
                background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
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
          <p className="mt-2 max-w-[78ch] text-[13px] leading-relaxed sm:text-sm" style={{ color: "var(--text-secondary)" }}>
            {fund.description.trim()}
          </p>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <div className="md:hidden">
        <MobileDetailAccordion
          title="Fon Profili"
          hint="Kimlik, risk sınıfı ve veri kapsamı."
          defaultOpen
        >
          {content}
        </MobileDetailAccordion>
      </div>

      <section aria-labelledby="fund-detail-profile-heading" className="hidden md:block">
        <div>
          <FundDetailSectionTitle id="fund-detail-profile-heading">Fon Profili</FundDetailSectionTitle>
          <p className="mt-1 text-[12px] leading-snug sm:text-[13px]" style={{ color: "var(--text-secondary)" }}>
            Fonun temel kimliği, risk sınıfı ve güncel veri kapsamı tek panelde özetlenir.
          </p>
        </div>
        <div className="mt-2">{content}</div>
      </section>
    </>
  );
}

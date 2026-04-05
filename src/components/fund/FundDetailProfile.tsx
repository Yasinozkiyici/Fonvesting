import { RiskBadge } from "@/components/tefas/ScoringComponents";
import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import { fundTypeDisplayLabel } from "@/lib/fund-type-display";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

type RowProps = { label: string; children: React.ReactNode };

function ProfileRow({ label, children }: RowProps) {
  return (
    <div className="flex flex-col gap-0.5 border-b py-3 last:border-b-0 sm:grid sm:grid-cols-[minmax(0,11rem)_1fr] sm:items-baseline sm:gap-6 sm:py-3.5">
      <div className="text-[11px] font-medium sm:text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="text-sm font-medium leading-snug sm:text-[14px]" style={{ color: "var(--text-primary)" }}>
        {children}
      </div>
    </div>
  );
}

type Props = { data: FundDetailPageData };

export function FundDetailProfile({ data }: Props) {
  const { fund, riskLevel, snapshotDate } = data;
  const typeLabel = fundTypeDisplayLabel(fund.fundType);

  const hasAny =
    typeLabel !== "—" ||
    fund.category ||
    riskLevel ||
    Boolean(snapshotDate) ||
    (fund.description && fund.description.trim().length > 0);

  if (!hasAny) return null;

  return (
    <section className="mt-8 sm:mt-10" aria-labelledby="fund-detail-profile-heading">
      <FundDetailSectionTitle id="fund-detail-profile-heading">Fon profili</FundDetailSectionTitle>
      <div
        className="mt-4 rounded-xl border px-4 py-1 sm:px-6"
        style={{ borderColor: "var(--border-subtle)", background: "var(--card-bg)" }}
      >
        <div>
          {typeLabel !== "—" ? <ProfileRow label="Fon türü">{typeLabel}</ProfileRow> : null}
          {fund.category ? <ProfileRow label="Kategori">{fund.category.name}</ProfileRow> : null}
          {riskLevel ? (
            <ProfileRow label="Risk profili (özet)">
              <RiskBadge level={riskLevel} />
            </ProfileRow>
          ) : null}
          {snapshotDate ? (
            <ProfileRow label="Özet veri tarihi">
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
            className="border-t py-4 sm:py-5"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Açıklama
            </p>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {fund.description.trim()}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

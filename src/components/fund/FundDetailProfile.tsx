import { RiskBadge } from "@/components/tefas/ScoringComponents";
import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import { fundTypeDisplayLabel } from "@/lib/fund-type-display";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

type RowProps = { label: string; hint?: string; children: React.ReactNode };

function ProfileRow({ label, hint, children }: RowProps) {
  return (
    <div className="flex flex-col gap-0.5 border-b py-3 last:border-b-0 sm:grid sm:grid-cols-[minmax(0,12rem)_1fr] sm:items-start sm:gap-8 sm:py-3.5">
      <div>
        <div className="text-[11px] font-medium sm:text-xs" style={{ color: "var(--text-muted)" }}>
          {label}
        </div>
        {hint ? (
          <p className="mt-0.5 text-[10px] leading-snug sm:text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            {hint}
          </p>
        ) : null}
      </div>
      <div className="text-sm font-medium leading-snug sm:text-[14px]" style={{ color: "var(--text-primary)" }}>
        {children}
      </div>
    </div>
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
  const { fund, riskLevel, snapshotDate, snapshotAlpha, modelBenchmark, tradingCurrency } = data;
  const typeLabel = fundTypeDisplayLabel(fund.fundType);

  const lastSyncLabel = fund.lastUpdatedAt ?? fund.updatedAt;

  return (
    <section aria-labelledby="fund-detail-profile-heading">
      <FundDetailSectionTitle id="fund-detail-profile-heading">Fon profili</FundDetailSectionTitle>
      <div
        className="mt-3.5 rounded-xl border px-4 py-1 sm:mt-4 sm:px-6"
        style={{ borderColor: "var(--border-subtle)", background: "var(--card-bg)" }}
      >
        <div>
          {typeLabel !== "—" ? <ProfileRow label="Fon türü">{typeLabel}</ProfileRow> : null}
          {fund.category ? <ProfileRow label="Kategori">{fund.category.name}</ProfileRow> : null}
          {fund.portfolioManagerInferred ? (
            <ProfileRow
              label="Portföy yöneticisi"
              hint="Fon unvanından türetilmiştir; resmi tescil metni değildir."
            >
              {fund.portfolioManagerInferred}
            </ProfileRow>
          ) : null}
          <ProfileRow label="İşlem para birimi" hint="TEFAS yurt içi işlem birimi.">
            {tradingCurrency}
          </ProfileRow>
          <ProfileRow label="Son güncelleme" hint="Sunucudaki fon kaydı (TEFAS senkronu).">
            <span className="tabular-nums text-[13px]" style={{ color: "var(--text-secondary)" }}>
              {formatDateTr(lastSyncLabel)}
            </span>
          </ProfileRow>
          <ProfileRow label="Getiri (TEFAS alanları)" hint="Son senkronize edilen tablo değerleri.">
            <span className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              <span style={{ color: "var(--text-tertiary)" }}>
                1H: {fmtTefasReturn(fund.weeklyReturn)}
              </span>
              <span style={{ color: "var(--text-tertiary)" }}>
                1A: {fmtTefasReturn(fund.monthlyReturn)}
              </span>
              <span style={{ color: "var(--text-tertiary)" }}>
                1Y: {fmtTefasReturn(fund.yearlyReturn)}
              </span>
            </span>
          </ProfileRow>
          {riskLevel ? (
            <ProfileRow label="Risk profili (özet)">
              <RiskBadge level={riskLevel} />
            </ProfileRow>
          ) : null}
          {modelBenchmark ? (
            <ProfileRow
              label="Model referansı"
              hint="Skorlama için kullanılan kategori kodu; fonun resmi kıyas göstergesi olmayabilir."
            >
              <span className="tabular-nums">
                {modelBenchmark.label}{" "}
                <span style={{ color: "var(--text-tertiary)" }}>({modelBenchmark.code})</span>
              </span>
            </ProfileRow>
          ) : null}
          {snapshotDate ? (
            <ProfileRow label="Skor / özet tarihi" hint="Günlük anlık görüntü tablosu.">
              <span className="tabular-nums text-[13px]" style={{ color: "var(--text-secondary)" }}>
                {new Date(snapshotDate).toLocaleDateString("tr-TR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </ProfileRow>
          ) : null}
          {snapshotAlpha != null && Number.isFinite(snapshotAlpha) && snapshotDate ? (
            <ProfileRow label="Alpha (model)" hint="Yıllıklandırılmış fon getirisi ile model referansı arasındaki fark; tahmini.">
              <span className="tabular-nums font-semibold">{fmtTefasReturn(snapshotAlpha)}</span>
            </ProfileRow>
          ) : null}
        </div>
        {fund.description && fund.description.trim().length > 0 ? (
          <div className="border-t py-4 sm:py-5" style={{ borderColor: "var(--border-subtle)" }}>
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

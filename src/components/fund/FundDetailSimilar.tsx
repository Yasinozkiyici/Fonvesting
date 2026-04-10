import Link from "next/link";
import { MobileDetailAccordion } from "@/components/fund/MobileDetailAccordion";
import { FundLogoMark } from "@/components/tefas/FundLogoMark";
import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import { fundDetailHref } from "@/lib/fund-routes";
import { fundDisplaySubtitle, formatFundLastPrice } from "@/lib/fund-list-format";
import type { FundDetailSimilarFund } from "@/lib/services/fund-detail.service";

/** Bu bölümde 1Y getiri; sakin ikincil ton. */
function MiniPctCalm({ value }: { value: number }) {
  const v = Number(value);
  if (!Number.isFinite(v) || Math.abs(v) > 1000) {
    return <span className="tabular-nums text-xs font-medium" style={{ color: "var(--text-muted)" }}>—</span>;
  }
  if (v === 0) {
    return <span className="tabular-nums text-xs font-medium" style={{ color: "var(--text-tertiary)" }}>0,00%</span>;
  }
  const pos = v > 0;
  return (
    <span className="tabular-nums text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
      {pos ? "+" : ""}
      {v.toFixed(2).replace(".", ",")}%
    </span>
  );
}

type Props = {
  funds: FundDetailSimilarFund[];
  categoryName: string | null;
  /** Phase 2 derin bağlantı / kaydırma hedefi (ör. fund-detail-alternatives) */
  sectionId?: string;
};

export function FundDetailSimilar({ funds, categoryName, sectionId }: Props) {
  if (funds.length === 0) return null;

  const subtitle = categoryName
    ? `Aynı kategoriden seçilmiş alternatifler (${categoryName}).`
    : "Aynı kategoriden seçilmiş alternatifler.";

  const content = (
    <div
      className="fund-detail-similar-dividers divide-y rounded-xl border"
      style={{ borderColor: "var(--border-subtle)", background: "var(--card-bg)" }}
    >
      {funds.map((f) => {
        const title = fundDisplaySubtitle(f);
        return (
          <Link
            key={f.code}
            href={fundDetailHref(f.code)}
            prefetch={false}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-[var(--surface-table-header)] sm:px-3.5 sm:py-3"
            style={{ color: "inherit" }}
          >
            <FundLogoMark
              code={f.code}
              logoUrl={f.logoUrl}
              wrapperClassName="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg sm:h-[2.25rem] sm:w-[2.25rem]"
              wrapperStyle={{
                border: "1px solid var(--border-subtle)",
                background: "var(--logo-plate-gradient)",
                color: "var(--text-secondary)",
              }}
              imgClassName="h-full w-full object-contain p-1"
              initialsClassName="text-[10px] font-semibold tracking-tight tabular-nums"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1">
                <p className="text-xs font-semibold tabular-nums tracking-tight sm:text-[13px]" style={{ color: "var(--text-primary)" }}>
                  {f.code}
                </p>
                <p
                  className="inline-flex w-fit rounded-full border px-1.5 py-[2px] text-[8px] font-semibold uppercase tracking-[0.08em] sm:px-2 sm:text-[9px]"
                  style={{
                    color: "var(--text-secondary)",
                    borderColor: "color-mix(in srgb, var(--border-subtle) 90%, transparent)",
                    background: "color-mix(in srgb, var(--bg-muted) 68%, var(--card-bg))",
                  }}
                >
                  {f.reasonLabel}
                </p>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug sm:text-[11.5px]" style={{ color: "var(--text-secondary)" }} title={f.name}>
                {title}
              </p>
            </div>
            <div
              className="flex min-w-[5.15rem] shrink-0 flex-col items-end gap-0.5 rounded-[0.85rem] border px-2 py-1.5 text-right"
              style={{
                    borderColor: "color-mix(in srgb, var(--border-subtle) 88%, transparent)",
                    background: "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))",
              }}
            >
              <span className="tabular-nums text-xs font-semibold sm:text-[13px]" style={{ color: "var(--text-primary)" }}>
                {formatFundLastPrice(f.lastPrice)}
              </span>
              <span className="text-[9px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--text-tertiary)" }}>
                1Y
              </span>
              <MiniPctCalm value={f.yearlyReturn} />
            </div>
          </Link>
        );
      })}
    </div>
  );

  return (
    <section id={sectionId} aria-labelledby="fund-detail-alternatives-heading">
      <div className="md:hidden">
        <MobileDetailAccordion
          title="Alternatifler"
          hint={subtitle}
          defaultOpen
        >
          {content}
        </MobileDetailAccordion>
      </div>

      <div className="hidden md:block">
        <FundDetailSectionTitle id="fund-detail-alternatives-heading">Alternatifler</FundDetailSectionTitle>
        <p className="mt-1 text-[12px] leading-snug sm:text-[13px]" style={{ color: "var(--text-secondary)" }}>
          {subtitle}
        </p>
        <div className="mt-2">{content}</div>
      </div>
    </section>
  );
}

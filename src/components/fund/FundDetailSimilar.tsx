import Link from "next/link";
import { MobileDetailAccordion } from "@/components/fund/MobileDetailAccordion";
import { FundLogoMark } from "@/components/tefas/FundLogoMark";
import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import { fundDetailHref } from "@/lib/fund-routes";
import { fundDisplaySubtitle } from "@/lib/fund-list-format";
import { formatDetailNavPrice, formatDetailSignedPercent } from "@/lib/fund-detail-format";
import type { FundDetailSimilarFund } from "@/lib/services/fund-detail.service";

/** 1Y getiri — ikincil ton, detay formatı ile. */
function MiniPctCalm({ value }: { value: number }) {
  const text = formatDetailSignedPercent(value, { maxAbs: 1000 });
  if (text === "—") {
    return <span className="tabular-nums text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>—</span>;
  }
  const v = Number(value);
  const pos = v > 0;
  const zero = v === 0;
  return (
    <span
      className="tabular-nums text-[11px] font-semibold tracking-[-0.015em] sm:text-xs"
      style={{ color: zero ? "var(--text-tertiary)" : pos ? "var(--success-muted)" : "var(--danger-muted, #b91c1c)" }}
    >
      {text}
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
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 transition-colors hover:bg-[var(--surface-table-header)] focus-within:bg-[var(--surface-table-header)] focus-visible:outline-none sm:gap-2 sm:px-3.5 sm:py-2"
            style={{ color: "inherit" }}
          >
            <FundLogoMark
              code={f.code}
              logoUrl={f.logoUrl}
              wrapperClassName="flex h-[1.95rem] w-[1.95rem] shrink-0 items-center justify-center overflow-hidden rounded-lg sm:h-8 sm:w-8"
              wrapperStyle={{
                border: "1px solid var(--border-subtle)",
                background: "var(--logo-plate-gradient)",
                color: "var(--text-secondary)",
              }}
              imgClassName="h-full w-full object-contain p-1"
              initialsClassName="text-[10px] font-semibold tracking-tight tabular-nums"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <p className="text-[11.5px] font-semibold tabular-nums tracking-tight sm:text-[12.5px]" style={{ color: "var(--text-primary)" }}>
                  {f.code}
                </p>
                <p
                  className="inline-flex w-fit shrink-0 rounded-full border px-1.5 py-[1px] text-[8px] font-semibold uppercase tracking-[0.08em] sm:px-2 sm:py-[2px] sm:text-[8.5px]"
                  style={{
                    color: "var(--text-secondary)",
                    borderColor: "color-mix(in srgb, var(--border-subtle) 90%, transparent)",
                    background: "color-mix(in srgb, var(--bg-muted) 68%, var(--card-bg))",
                  }}
                >
                  {f.reasonLabel}
                </p>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug sm:text-[11px]" style={{ color: "var(--text-secondary)" }} title={f.name}>
                {title}
              </p>
            </div>
            <div
              className="flex min-w-[4.85rem] shrink-0 flex-col items-end justify-center gap-0.5 self-stretch rounded-[0.65rem] border px-1.5 py-1 text-right sm:min-w-[5rem] sm:px-1.75 sm:py-1.25"
              style={{
                    borderColor: "color-mix(in srgb, var(--border-subtle) 74%, transparent)",
                    background: "color-mix(in srgb, var(--card-bg) 90%, var(--bg-muted))",
              }}
            >
              <span className="tabular-nums text-[12.5px] font-semibold leading-none tracking-[-0.02em] sm:text-[13px]" style={{ color: "var(--text-primary)" }}>
                {formatDetailNavPrice(f.lastPrice)}
              </span>
              <div className="flex w-full flex-col items-end gap-0.5 border-t pt-1" style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 65%, transparent)" }}>
                <span className="text-[8.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                  1Y getiri
                </span>
                <MiniPctCalm value={f.yearlyReturn} />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );

  return (
    <section
      id={sectionId}
      aria-labelledby="fund-detail-alternatives-heading"
      data-detail-section="compare"
      className="scroll-mt-28 md:scroll-mt-0"
    >
      <div className="md:hidden">
        <MobileDetailAccordion
          title="Karşılaştırma"
          hint={subtitle}
          defaultOpen={false}
        >
          {content}
        </MobileDetailAccordion>
      </div>

      <div className="hidden md:block">
        <FundDetailSectionTitle id="fund-detail-alternatives-heading">Alternatifler</FundDetailSectionTitle>
        <p className="mt-1.5 text-[12px] leading-relaxed sm:text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          {subtitle}
        </p>
        <div className="mt-2.5">{content}</div>
      </div>
    </section>
  );
}

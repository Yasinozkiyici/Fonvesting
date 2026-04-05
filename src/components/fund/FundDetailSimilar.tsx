import Link from "next/link";
import { FundLogoMark } from "@/components/tefas/FundLogoMark";
import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";
import { fundDetailHref } from "@/lib/fund-routes";
import { fundDisplaySubtitle, formatFundLastPrice } from "@/lib/fund-list-format";
import type { FundDetailSimilarFund } from "@/lib/services/fund-detail.service";

function MiniPct({ value }: { value: number }) {
  const v = Number(value);
  if (!Number.isFinite(v) || Math.abs(v) > 100) {
    return <span className="tabular-nums text-xs font-medium" style={{ color: "var(--text-muted)" }}>—</span>;
  }
  if (v === 0) {
    return <span className="tabular-nums text-xs font-medium" style={{ color: "var(--text-secondary)" }}>0,00%</span>;
  }
  const pos = v > 0;
  return (
    <span
      className="tabular-nums text-xs font-semibold"
      style={{ color: pos ? "var(--success)" : "var(--danger)" }}
    >
      {pos ? "+" : ""}
      {v.toFixed(2).replace(".", ",")}%
    </span>
  );
}

type Props = { funds: FundDetailSimilarFund[]; categoryName: string | null };

export function FundDetailSimilar({ funds, categoryName }: Props) {
  if (funds.length === 0) return null;

  const subtitle = categoryName ? `Aynı kategoride, büyüklüğe göre.` : "Benzer ölçekte diğer fonlar.";

  return (
    <section aria-labelledby="fund-detail-similar-heading">
      <FundDetailSectionTitle id="fund-detail-similar-heading">Benzer fonlar</FundDetailSectionTitle>
      <p className="mt-1.5 text-[13px] leading-relaxed sm:text-sm" style={{ color: "var(--text-secondary)" }}>
        {subtitle}
      </p>
      <div
        className="mt-3.5 divide-y rounded-xl border sm:mt-4"
        style={{ borderColor: "var(--border-subtle)", background: "var(--card-bg)" }}
      >
        {funds.map((f) => {
          const title = fundDisplaySubtitle(f);
          return (
            <Link
              key={f.code}
              href={fundDetailHref(f.code)}
              className="flex items-center gap-3 px-4 py-3 transition-colors sm:gap-4 sm:px-5 sm:py-3.5"
              style={{ color: "inherit" }}
            >
              <FundLogoMark
                code={f.code}
                logoUrl={f.logoUrl}
                wrapperClassName="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg sm:h-10 sm:w-10"
                wrapperStyle={{
                  border: "1px solid var(--border-subtle)",
                  background: "var(--logo-plate-gradient)",
                  color: "var(--text-secondary)",
                }}
                imgClassName="h-full w-full object-contain p-1"
                initialsClassName="text-[10px] font-semibold tracking-tight tabular-nums"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold tabular-nums tracking-tight sm:text-[13px]" style={{ color: "var(--text-primary)" }}>
                  {f.code}
                </p>
                <p className="truncate text-[11px] leading-snug sm:text-xs" style={{ color: "var(--text-tertiary)" }} title={f.name}>
                  {title}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                <span className="tabular-nums text-xs font-semibold sm:text-[13px]" style={{ color: "var(--text-primary)" }}>
                  {formatFundLastPrice(f.lastPrice)}
                </span>
                <MiniPct value={f.dailyReturn} />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

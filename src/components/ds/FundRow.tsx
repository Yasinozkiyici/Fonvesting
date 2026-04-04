import Link from "next/link";
import { fundDetailHref } from "@/lib/fund-routes";
import type { ScoredFund } from "@/types/scored-funds";
import {
  fundDisplaySubtitle,
  formatCompactCurrency,
  formatCompactNumber,
  formatFundLastPrice,
} from "@/lib/fund-list-format";
import { FundLogoMark } from "@/components/tefas/FundLogoMark";
import { PctChangeMobile, PctChangeTable } from "@/components/ds/PctChange";

export function FundRowMobile({ fund }: { fund: ScoredFund }) {
  const subtitle = fundDisplaySubtitle(fund);
  const typeLabel = fund.fundType?.name?.trim() || "—";

  return (
    <div className="mobile-fund-card">
      <Link href={fundDetailHref(fund.code)} className="mobile-fund-card__link">
        <div className="flex items-start gap-2">
          <FundLogoMark
            code={fund.code}
            logoUrl={fund.logoUrl}
            wrapperClassName="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border"
            wrapperStyle={{
              borderColor: "var(--mfc-border)",
              background: "var(--logo-plate-gradient)",
              color: "var(--mfc-secondary)",
            }}
            imgClassName="h-full w-full object-contain p-1"
            initialsClassName="text-[9px] font-semibold tracking-tight tabular-nums"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
                <span className="mobile-fund-card__code shrink-0">{fund.code}</span>
                <span className="mobile-fund-card__name min-w-0 truncate" title={fund.name}>
                  {subtitle}
                </span>
              </div>
              <PctChangeMobile value={fund.dailyReturn} />
            </div>
            <div className="flex min-w-0 flex-nowrap items-center gap-x-0 overflow-hidden">
              <span className="fund-type-chip fund-type-chip--mobile min-w-0 max-w-[min(100%,11rem)] truncate" title={typeLabel}>
                {typeLabel}
              </span>
              <span className="mobile-fund-card__dot" aria-hidden>
                ·
              </span>
              <span className="mobile-fund-card__metric shrink-0 tabular-nums">{formatFundLastPrice(fund.lastPrice)}</span>
              <span className="mobile-fund-card__dot" aria-hidden>
                ·
              </span>
              <span className="mobile-fund-card__metric shrink-0 tabular-nums">{formatCompactNumber(fund.investorCount)}</span>
              <span className="mobile-fund-card__dot" aria-hidden>
                ·
              </span>
              <span className="mobile-fund-card__metric shrink-0 tabular-nums">{formatCompactCurrency(fund.portfolioSize)}</span>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}

export function FundDataTableRow({ fund }: { fund: ScoredFund }) {
  const subtitle = fundDisplaySubtitle(fund);
  const typeLabel = fund.fundType?.name?.trim() || "—";

  return (
    <tr className="table-row fund-data-row group">
      <td className="fund-col-name">
        <Link
          href={fundDetailHref(fund.code)}
          className="fund-name-link flex min-w-0 max-w-full items-center gap-2 py-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] focus-visible:ring-offset-1 md:gap-2.5"
          style={{ color: "inherit" }}
        >
          <FundLogoMark
            code={fund.code}
            logoUrl={fund.logoUrl}
            wrapperClassName="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg md:h-9 md:w-9"
            wrapperStyle={{
              border: "1px solid var(--border-subtle)",
              background: "var(--logo-plate-gradient)",
              color: "var(--text-secondary)",
            }}
            imgClassName="h-full w-full object-contain p-1"
            initialsClassName="text-[9px] font-semibold tracking-tight tabular-nums"
          />
          <div className="min-w-0 flex-1 overflow-hidden">
            <p
              className="truncate text-[13px] font-semibold leading-tight tracking-[-0.02em] md:text-[14px]"
              style={{ color: "var(--text-primary)" }}
            >
              {fund.code}
            </p>
            <p
              className="truncate text-[11px] leading-snug md:text-[12px]"
              style={{ color: "var(--text-tertiary)" }}
              title={fund.name}
            >
              {subtitle}
            </p>
          </div>
        </Link>
      </td>
      <td className="fund-col-gutter" aria-hidden="true" />
      <td className="fund-col-type">
        <span className="fund-type-chip inline-block max-w-full truncate align-middle" title={typeLabel}>
          {typeLabel}
        </span>
      </td>
      <td className="fund-col-num fund-col-metric table-num whitespace-nowrap">
        <span
          className="text-[12px] font-semibold tabular-nums tracking-[-0.02em] md:text-[13px]"
          style={{ color: "var(--text-primary)" }}
        >
          {formatFundLastPrice(fund.lastPrice)}
        </span>
      </td>
      <td className="fund-col-num fund-col-metric table-num whitespace-nowrap">
        <PctChangeTable value={fund.dailyReturn} />
      </td>
      <td className="fund-col-num fund-col-metric table-num whitespace-nowrap">
        <span className="text-[12px] font-medium tabular-nums md:text-[13px]" style={{ color: "var(--text-secondary)" }}>
          {formatCompactNumber(fund.investorCount)}
        </span>
      </td>
      <td className="fund-col-num fund-col-metric fund-col-aum table-num whitespace-nowrap">
        <span className="text-[12px] font-semibold tabular-nums tracking-[-0.02em] md:text-[13px]" style={{ color: "var(--text-primary)" }}>
          {formatCompactCurrency(fund.portfolioSize)}
        </span>
      </td>
    </tr>
  );
}

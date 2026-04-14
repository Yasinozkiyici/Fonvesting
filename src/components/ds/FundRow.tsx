"use client";

import { memo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { fundDetailHref } from "@/lib/fund-routes";
import type { ScoredFund } from "@/types/scored-funds";
import type { FundListRow } from "@/lib/services/fund-list.service";
import {
  fundDisplaySubtitle,
  formatCompactCurrency,
  formatCompactNumber,
  formatFundLastPrice,
} from "@/lib/fund-list-format";
import { FundLogoMark } from "@/components/tefas/FundLogoMark";
import { PctChangeMobile, PctChangeTable } from "@/components/ds/PctChange";
import { fundTypeChipToneClass } from "@/lib/fund-type-chip-tone";
import { fundTypeDisplayLabel } from "@/lib/fund-type-display";
import { FundCompareControl } from "@/components/compare/FundCompareControl";
import { classifyDailyReturnPctPoints2dp, formatDailyReturnPctPointsTr } from "@/lib/daily-return-ui";

function cardDescriptor(typeLabel: string, categoryName: string | null | undefined): string {
  return [categoryName, typeLabel !== "—" ? typeLabel : null].filter(Boolean).join(" • ");
}

/** Ana sayfa mobil liste — gün yönü için kısa, skor dili yok */
function mobileDailySignalLabel(dailyReturn: number): string {
  switch (classifyDailyReturnPctPoints2dp(dailyReturn)) {
    case "positive":
      return "Yükseliş";
    case "negative":
      return "Düşüş";
    default:
      return "Nötr";
  }
}

export const FundRowMobile = memo(function FundRowMobile({ fund }: { fund: ScoredFund }) {
  const subtitle = fundDisplaySubtitle(fund);
  const typeLabel = fundTypeDisplayLabel(fund.fundType);
  const kindLine =
    fund.category?.name?.trim() ||
    (typeLabel !== "—" ? typeLabel : null) ||
    "—";
  const pct = formatDailyReturnPctPointsTr(fund.dailyReturn);
  const pctColor =
    pct.sign === "neutral"
      ? "var(--text-secondary)"
      : pct.sign === "positive"
        ? "var(--success)"
        : "var(--danger)";
  const signal = mobileDailySignalLabel(fund.dailyReturn);
  const secondaryLine = `${formatFundLastPrice(fund.lastPrice)} · ${formatCompactCurrency(fund.portfolioSize)} · ${formatCompactNumber(fund.investorCount)} yatırımcı`;

  return (
    <div className="mobile-fund-card mobile-fund-card--scan mobile-fund-card--with-compare flex min-w-0 gap-0.5">
      <Link href={fundDetailHref(fund.code)} prefetch={false} className="mobile-fund-card__link mobile-fund-card__link--with-compare min-w-0 flex-1">
        <div className="flex min-w-0 items-stretch gap-2.5">
          <FundLogoMark
            code={fund.code}
            logoUrl={fund.logoUrl}
            wrapperClassName="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[0.85rem] border"
            wrapperStyle={{
              borderColor: "var(--mfc-border)",
              background: "var(--logo-plate-gradient)",
              color: "var(--mfc-secondary)",
            }}
            imgClassName="h-full w-full object-contain p-[0.32rem]"
            initialsClassName="text-[10px] font-semibold tracking-tight tabular-nums"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-semibold tabular-nums tracking-tight" style={{ color: "var(--text-tertiary)" }}>
                  {fund.code}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-[1.22] tracking-[-0.02em]" style={{ color: "var(--text-primary)" }} title={subtitle}>
                  {subtitle}
                </p>
                <p className="mt-0.5 truncate text-[11px] font-medium leading-snug" style={{ color: "var(--text-tertiary)" }} title={kindLine}>
                  {kindLine}
                </p>
              </div>
              <ChevronRight className="mt-0.5 h-[18px] w-[18px] shrink-0 opacity-[0.28]" strokeWidth={2} aria-hidden style={{ color: "var(--text-primary)" }} />
            </div>

            <div className="flex min-w-0 items-end justify-between gap-2 border-t border-[color-mix(in_srgb,var(--border-subtle)_70%,transparent)] pt-1.5">
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
                  1G
                </p>
                <p className="tabular-nums text-[15px] font-semibold leading-none tracking-[-0.02em]" style={{ color: pctColor }}>
                  {pct.text}
                </p>
              </div>
              <p className="shrink-0 pb-0.5 text-[10px] font-semibold" style={{ color: "var(--text-tertiary)" }}>
                {signal}
              </p>
            </div>

            <p className="truncate text-[10px] font-medium tabular-nums leading-tight" style={{ color: "var(--text-muted)" }} title={secondaryLine}>
              {secondaryLine}
            </p>
          </div>
        </div>
      </Link>
      <div
        className="flex shrink-0 flex-col justify-center self-stretch border-l pl-1"
        style={{ borderColor: "color-mix(in srgb, var(--mfc-border) 78%, transparent)" }}
      >
        <FundCompareControl code={fund.code} variant="card" />
      </div>
    </div>
  );
});

export function FundListRowMobile({ fund }: { fund: FundListRow }) {
  const subtitle = fundDisplaySubtitle(fund);
  const typeLabel = fundTypeDisplayLabel(fund.fundType);
  const descriptor = cardDescriptor(typeLabel, fund.category?.name ?? null);

  return (
    <div className="mobile-fund-card mobile-fund-card--with-compare flex min-w-0 gap-0.5">
      <Link
        href={fundDetailHref(fund.code)}
        prefetch={false}
        className="mobile-fund-card__link mobile-fund-card__link--with-compare min-w-0 flex-1"
      >
        <div className="flex items-start gap-2">
          <FundLogoMark
            code={fund.code}
            logoUrl={fund.logoUrl}
            wrapperClassName="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[0.8rem] border"
            wrapperStyle={{
              borderColor: "var(--mfc-border)",
              background: "var(--logo-plate-gradient)",
              color: "var(--mfc-secondary)",
            }}
            imgClassName="h-full w-full object-contain p-[0.34rem]"
            initialsClassName="text-[9px] font-semibold tracking-tight tabular-nums"
          />
          <div className="min-w-0 flex-1">
            <div className="min-w-0">
              <p className="mobile-fund-card__code truncate">{fund.code}</p>
              <p className="mobile-fund-card__name mt-px truncate" title={subtitle}>
                {subtitle}
              </p>
            </div>

            <div className="mt-[0.28rem] flex items-end justify-between gap-2.5">
              <span className="mobile-fund-card__price tabular-nums">{formatFundLastPrice(fund.lastPrice)}</span>
              <span className="shrink-0">
                <PctChangeMobile value={fund.dailyReturn} />
              </span>
            </div>

            <div className="mobile-fund-card__meta mt-[0.28rem] flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{descriptor || "—"}</span>
              <span className="shrink-0 tabular-nums">
                {formatCompactCurrency(fund.portfolioSize)} • {formatCompactNumber(fund.investorCount)}
              </span>
            </div>
          </div>
        </div>
      </Link>
      <div
        className="flex shrink-0 flex-col justify-center self-stretch border-l pl-1"
        style={{ borderColor: "color-mix(in srgb, var(--mfc-border) 78%, transparent)" }}
      >
        <FundCompareControl code={fund.code} variant="card" />
      </div>
    </div>
  );
}

export const FundDataTableRow = memo(function FundDataTableRow({ fund }: { fund: ScoredFund }) {
  const subtitle = fundDisplaySubtitle(fund);
  const typeLabel = fundTypeDisplayLabel(fund.fundType);
  const typeTone = fundTypeChipToneClass(fund.fundType, typeLabel);

  return (
    <tr className="table-row fund-data-row group">
      <td className="fund-col-name">
        <div className="flex min-w-0 items-center gap-1.5 py-0.5 md:gap-2">
          <Link
            href={fundDetailHref(fund.code)}
            prefetch={false}
            className="fund-name-link flex min-w-0 max-w-full flex-1 items-center gap-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] focus-visible:ring-offset-1 md:gap-2.5"
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
                style={{ color: "var(--text-tertiary)", opacity: 0.88 }}
                title={fund.name}
              >
                {subtitle}
              </p>
            </div>
          </Link>
        </div>
      </td>
      <td className="fund-col-gutter" aria-hidden="true" />
      <td className="fund-col-type">
        <span
          className={`fund-type-chip ${typeTone} inline-block max-w-full truncate align-middle`}
          title={typeLabel}
        >
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
      <td className="fund-col-compare table-num">
        <div className="flex justify-end">
          <FundCompareControl code={fund.code} />
        </div>
      </td>
    </tr>
  );
});

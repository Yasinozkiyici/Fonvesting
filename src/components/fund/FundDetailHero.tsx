import Link from "next/link";
import { FundLogoMark } from "@/components/tefas/FundLogoMark";
import {
  formatCompactCurrency,
  formatCompactNumber,
  formatFundLastPrice,
  fundDisplaySubtitle,
} from "@/lib/fund-list-format";
import { fundTypeChipToneClass } from "@/lib/fund-type-chip-tone";
import { fundTypeDisplayLabel } from "@/lib/fund-type-display";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

function HeroPct({ value }: { value: number }) {
  const v = Number(value);
  if (!Number.isFinite(v) || Math.abs(v) > 100) {
    return (
      <span className="tabular-nums text-lg font-semibold tracking-[-0.02em] sm:text-xl" style={{ color: "var(--text-secondary)" }}>
        —
      </span>
    );
  }
  if (v === 0) {
    return (
      <span className="tabular-nums text-lg font-semibold tracking-[-0.02em] sm:text-xl" style={{ color: "var(--text-secondary)" }}>
        0,00%
      </span>
    );
  }
  const pos = v > 0;
  return (
    <span
      className="tabular-nums text-lg font-semibold tracking-[-0.02em] sm:text-xl"
      style={{ color: pos ? "var(--success)" : "var(--danger)" }}
    >
      {pos ? "+" : ""}
      {v.toFixed(2).replace(".", ",")}%
    </span>
  );
}

type Props = { data: FundDetailPageData };

export function FundDetailHero({ data }: Props) {
  const { fund } = data;
  const subtitle = fundDisplaySubtitle(fund);
  const typeLabel = fundTypeDisplayLabel(fund.fundType);
  const typeTone = fundTypeChipToneClass(fund.fundType, typeLabel);

  return (
    <section
      className="rounded-xl border px-4 py-5 sm:px-6 sm:py-6"
      style={{
        borderColor: "var(--border-subtle)",
        background: "var(--card-bg)",
        boxShadow: "var(--shadow-xs)",
      }}
      aria-labelledby="fund-detail-identity-heading"
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <div className="flex min-w-0 flex-1 gap-4 sm:gap-5">
          <FundLogoMark
            code={fund.code}
            logoUrl={fund.logoUrl}
            wrapperClassName="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl sm:h-[4.5rem] sm:w-[4.5rem]"
            wrapperStyle={{
              border: "1px solid var(--border-subtle)",
              background: "var(--logo-plate-gradient)",
              color: "var(--text-secondary)",
            }}
            imgClassName="h-full w-full object-contain p-1.5"
            initialsClassName="text-sm font-semibold tracking-tight tabular-nums"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium sm:text-xs" style={{ color: "var(--text-muted)" }}>
              <Link
                href="/"
                className="transition-opacity hover:opacity-75"
                style={{ color: "var(--accent)" }}
              >
                Fon sıralaması
              </Link>
              <span aria-hidden className="px-1 opacity-50">
                /
              </span>
              <span className="tabular-nums">{fund.code}</span>
            </p>
            <h1
              id="fund-detail-identity-heading"
              className="mt-1.5 text-xl font-semibold leading-tight tracking-[-0.03em] sm:text-2xl"
              style={{ color: "var(--text-primary)" }}
            >
              {subtitle}
            </h1>
            <p className="mt-1 text-xs leading-snug sm:text-[13px]" style={{ color: "var(--text-tertiary)" }} title={fund.name}>
              {fund.name}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`fund-type-chip ${typeTone}`} title={typeLabel}>
                {typeLabel}
              </span>
              {fund.category ? (
                <span
                  className="inline-flex max-w-full items-center rounded-md border px-2 py-[3px] text-[10px] font-semibold tracking-[-0.01em] sm:text-[11px]"
                  style={{
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-secondary)",
                    background: "var(--bg-muted)",
                  }}
                  title={fund.category.name}
                >
                  <span className="truncate">{fund.category.name}</span>
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <dl className="grid w-full shrink-0 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 lg:w-auto lg:min-w-[min(100%,28rem)] lg:grid-cols-2 xl:min-w-[32rem] xl:grid-cols-4">
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide sm:text-[11px]" style={{ color: "var(--text-muted)" }}>
              Son fiyat
            </dt>
            <dd
              className="mt-0.5 tabular-nums text-base font-semibold tracking-[-0.02em] sm:text-lg"
              style={{ color: "var(--text-primary)" }}
            >
              {formatFundLastPrice(fund.lastPrice)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide sm:text-[11px]" style={{ color: "var(--text-muted)" }}>
              1G
            </dt>
            <dd className="mt-0.5">
              <HeroPct value={fund.dailyReturn} />
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide sm:text-[11px]" style={{ color: "var(--text-muted)" }}>
              Yatırımcı
            </dt>
            <dd
              className="mt-0.5 tabular-nums text-base font-semibold tracking-[-0.02em] sm:text-lg"
              style={{ color: "var(--text-primary)" }}
            >
              {formatCompactNumber(fund.investorCount)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide sm:text-[11px]" style={{ color: "var(--text-muted)" }}>
              Portföy
            </dt>
            <dd
              className="mt-0.5 tabular-nums text-base font-semibold tracking-[-0.02em] sm:text-lg"
              style={{ color: "var(--text-primary)" }}
            >
              {formatCompactCurrency(fund.portfolioSize)}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

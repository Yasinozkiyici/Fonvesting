import Link from "next/link";
import { FundLogoMark } from "@/components/tefas/FundLogoMark";
import { formatCompactCurrency, formatCompactNumber, fundDisplaySubtitle } from "@/lib/fund-list-format";
import { formatDetailNavPrice, formatDetailSignedPercent } from "@/lib/fund-detail-format";
import { fundTypeChipToneClass } from "@/lib/fund-type-chip-tone";
import { fundTypeDisplayLabel } from "@/lib/fund-type-display";
import type { FundDetailPageData } from "@/lib/services/fund-detail.service";

function HeroPct({ value }: { value: number }) {
  const v = Number(value);
  const text = formatDetailSignedPercent(v, { maxAbs: 100 });
  if (text === "—") {
    return (
      <span className="tabular-nums text-[14px] font-semibold tracking-[-0.02em] sm:text-[17px]" style={{ color: "var(--text-secondary)" }}>
        —
      </span>
    );
  }
  const pos = v > 0;
  const zero = v === 0;
  return (
    <span
      className="tabular-nums text-[14px] font-semibold tracking-[-0.02em] sm:text-[17px]"
      style={{ color: zero ? "var(--text-secondary)" : pos ? "var(--success)" : "var(--danger)" }}
    >
      {text}
    </span>
  );
}

type Props = { data: FundDetailPageData };

export function FundDetailHero({ data }: Props) {
  const { fund } = data;
  const subtitle = fundDisplaySubtitle(fund);
  const helperText =
    fund.name.trim() && fund.name.trim() !== subtitle.trim()
      ? fund.name.trim()
      : null;
  const typeLabel = fundTypeDisplayLabel(fund.fundType);
  const typeTone = fundTypeChipToneClass(fund.fundType, typeLabel);

  const investorFull = Number.isFinite(fund.investorCount)
    ? Math.max(0, Math.round(fund.investorCount)).toLocaleString("tr-TR")
    : "—";

  return (
    <section
      data-detail-section="overview"
      className="scroll-mt-28 rounded-[1.05rem] border px-3 py-2.5 sm:scroll-mt-0 sm:px-4.5 sm:py-3.5 md:scroll-mt-0 lg:px-5 lg:py-4"
      style={{
        borderColor: "var(--border-subtle)",
        background: "var(--card-bg)",
        boxShadow: "var(--shadow-xs)",
      }}
      aria-labelledby="fund-detail-identity-heading"
    >
      <div className="flex flex-col gap-2.5 sm:gap-3 lg:grid lg:grid-cols-[minmax(0,1.45fr)_minmax(21rem,27rem)] lg:items-center lg:gap-4">
        <div className="flex min-w-0 items-start gap-2.5 sm:gap-3">
          <FundLogoMark
            code={fund.code}
            logoUrl={fund.logoUrl}
            wrapperClassName="flex h-[2.8rem] w-[2.8rem] shrink-0 items-center justify-center overflow-hidden rounded-[0.9rem] sm:h-[3.2rem] sm:w-[3.2rem] lg:h-[3.35rem] lg:w-[3.35rem]"
            wrapperStyle={{
              border: "1px solid var(--border-subtle)",
              background: "var(--logo-plate-gradient)",
              color: "var(--text-secondary)",
            }}
            imgClassName="h-full w-full object-contain p-1.5 sm:p-[0.36rem]"
            initialsClassName="text-[12px] font-semibold tracking-tight tabular-nums"
          />
          <div className="min-w-0 flex-1 lg:max-w-[42rem]">
            <Link
              href="/"
              prefetch={false}
              className="mb-1 inline-flex text-[11px] font-semibold transition-opacity hover:opacity-90 md:hidden"
              style={{ color: "var(--text-secondary)" }}
            >
              ← Tüm fonlar
            </Link>
            <p className="hidden text-[9.5px] font-medium tracking-[0.03em] sm:text-[10px] md:block" style={{ color: "var(--text-muted)" }}>
              <Link
                href="/"
                className="transition-colors hover:opacity-90"
                style={{ color: "var(--text-secondary)" }}
              >
                Fon sıralaması
              </Link>
              <span aria-hidden className="px-1 opacity-50">
                /
              </span>
              <span>Fon detayı</span>
            </p>
            <div className="mt-1.5 flex min-w-0 items-start gap-2">
              <span
                className="inline-flex shrink-0 rounded-md border px-1.5 py-[3px] text-[10px] font-semibold tabular-nums tracking-[0.02em] sm:text-[10.5px]"
                style={{
                  borderColor: "color-mix(in srgb, var(--border-subtle) 88%, transparent)",
                  background: "color-mix(in srgb, var(--card-bg) 92%, var(--bg-muted))",
                  color: "var(--text-secondary)",
                }}
              >
                {fund.code}
              </span>
              <h1
                id="fund-detail-identity-heading"
                className="min-w-0 max-w-[32rem] text-[1rem] font-semibold leading-[1.12] tracking-[-0.028em] sm:text-[1.12rem] lg:max-w-[38rem] lg:text-[1.18rem] xl:max-w-[42rem]"
                style={{ color: "var(--text-primary)" }}
              >
                <span className="line-clamp-3 sm:line-clamp-2">{subtitle}</span>
              </h1>
            </div>
            {helperText ? (
              <p
                className="mt-1 max-w-[42rem] line-clamp-2 text-[10px] leading-snug sm:line-clamp-1 sm:text-[11px]"
                style={{ color: "var(--text-tertiary)" }}
                title={fund.name}
              >
                {helperText}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-1.25 sm:gap-1.5">
              <span className={`fund-type-chip ${typeTone}`} title={typeLabel}>
                {typeLabel}
              </span>
              {fund.category ? (
                <span
                  className="inline-flex max-w-full items-center rounded-md border px-1.75 py-0.5 text-[10px] font-medium tracking-[0.01em] sm:text-[11px]"
                  style={{
                    borderColor: "color-mix(in srgb, var(--border-subtle) 90%, transparent)",
                    color: "var(--text-secondary)",
                    background: "color-mix(in srgb, var(--card-bg) 92%, var(--bg-muted))",
                  }}
                  title={fund.category.name}
                >
                  <span>{fund.category.name}</span>
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div
          className="w-full shrink-0 rounded-[0.95rem] border px-2.5 py-2 sm:px-3 sm:py-2.5 lg:w-full lg:max-w-[27rem] lg:self-center"
          style={{
            borderColor: "color-mix(in srgb, var(--border-subtle) 88%, transparent)",
            background: "color-mix(in srgb, var(--card-bg) 94%, var(--bg-muted))",
          }}
        >
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1.5 sm:grid-cols-4 sm:gap-x-2.5 sm:gap-y-2">
            <div className="min-w-0 rounded-[0.8rem] px-1 py-0.5">
              <dt className="text-[9.5px] font-medium uppercase tracking-[0.05em] sm:text-[10px]" style={{ color: "var(--text-muted)" }}>
                Son fiyat
              </dt>
              <dd
                className="mt-0.5 min-w-0 tabular-nums text-[13px] font-semibold leading-tight tracking-[-0.02em] sm:text-[15px]"
                style={{ color: "var(--text-primary)", overflowWrap: "anywhere" }}
              >
                {formatDetailNavPrice(fund.lastPrice)}
              </dd>
            </div>
            <div className="min-w-0 rounded-[0.8rem] px-1 py-0.5">
              <dt className="text-[9.5px] font-medium uppercase tracking-[0.05em] sm:text-[10px]" style={{ color: "var(--text-muted)" }}>
                1G
              </dt>
              <dd className="mt-0.5">
                <HeroPct value={fund.dailyReturn} />
              </dd>
            </div>
            <div className="col-span-2 hidden min-w-0 rounded-[0.8rem] px-1 py-0.5 sm:col-span-1 sm:block">
              <dt className="text-[9.5px] font-medium uppercase tracking-[0.05em] sm:text-[10px]" style={{ color: "var(--text-muted)" }}>
                Yatırımcı
              </dt>
              <dd
                className="mt-0.5 truncate tabular-nums text-[13px] font-semibold tracking-[-0.018em] sm:text-[15px]"
                style={{ color: "var(--text-primary)" }}
              >
                {formatCompactNumber(fund.investorCount)}
              </dd>
            </div>
            <div className="col-span-2 hidden min-w-0 rounded-[0.8rem] px-1 py-0.5 sm:col-span-1 sm:block">
              <dt className="text-[9.5px] font-medium uppercase tracking-[0.05em] sm:text-[10px]" style={{ color: "var(--text-muted)" }}>
                Portföy
              </dt>
              <dd
                className="mt-0.5 truncate tabular-nums text-[13px] font-semibold tracking-[-0.018em] sm:text-[15px]"
                style={{ color: "var(--text-primary)" }}
              >
                {formatCompactCurrency(fund.portfolioSize)}
              </dd>
            </div>
          </dl>
          <p
            className="mt-1.5 border-t pt-1.5 text-[11px] font-medium tabular-nums leading-snug sm:hidden"
            style={{ color: "var(--text-tertiary)", borderColor: "color-mix(in srgb, var(--border-subtle) 65%, transparent)" }}
          >
            <span style={{ color: "var(--text-muted)" }}>Portföy </span>
            <span style={{ color: "var(--text-primary)" }}>{formatCompactCurrency(fund.portfolioSize)}</span>
            <span className="mx-1.5 opacity-40" aria-hidden>
              ·
            </span>
            <span style={{ color: "var(--text-muted)" }}>Yatırımcı </span>
            <span style={{ color: "var(--text-primary)" }}>{investorFull}</span>
          </p>
        </div>
      </div>
    </section>
  );
}

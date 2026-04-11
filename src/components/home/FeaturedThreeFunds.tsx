"use client";

import Link from "next/link";
import type { ScoredFund } from "@/types/scored-funds";
import { fundDetailHref } from "@/lib/fund-routes";
import { FundLogoMark } from "@/components/tefas/FundLogoMark";
import { formatFundLastPrice } from "@/lib/fund-list-format";
import { classifyDailyReturnPctPoints2dp, formatDailyReturnPctPointsTr } from "@/lib/daily-return-ui";

function fmt1g(d: number) {
  return formatDailyReturnPctPointsTr(d).text;
}

function daily1gMutedColor(d: number): string {
  const c = classifyDailyReturnPctPoints2dp(d);
  if (c === "positive") return "var(--success-muted)";
  if (c === "negative") return "var(--danger-muted)";
  return "var(--text-secondary)";
}

/** TEFAS uzun / resmi ad; yoksa kısa ad, en son kod. */
function legalDisplayName(f: ScoredFund): string {
  const full = (f.name || "").trim();
  if (full.length > 0) return full;
  const short = (f.shortName || "").trim();
  if (short.length > 0) return short;
  return (f.code || "").trim();
}

export function FeaturedThreeFunds({
  items,
  title,
  subtitle,
  connected,
  embedded,
  variant = "default",
  routeActive = false,
}: {
  items: Array<{ fund: ScoredFund; tag: string; micro?: string | null; pickHint?: string | null }>;
  /** Üst keşif modülüyle bağlantılı başlık */
  title?: string;
  subtitle?: string;
  /** @deprecated Keşif modülü içi için `embedded` kullanın */
  connected?: boolean;
  /** Keşif modülü gövdesinde — tablo yüzeyiyle aynı aile, ayrı mavi blok yok */
  embedded?: boolean;
  /** `signature`: ana sayfa keşif üçlüsü — premium yatay öneri şeridi */
  variant?: "default" | "signature";
  /** Seçili rota var; başlık/alt metin bağlamı */
  routeActive?: boolean;
}) {
  if (items.length === 0) return null;

  const head = title ?? "Öne çıkan 3 fon";
  const isEmbedded = Boolean(embedded ?? connected);
  const sig = variant === "signature" && isEmbedded;

  return (
    <div
      className={isEmbedded ? "mt-2.5 border-t border-dashed pt-2.5 sm:mt-3 sm:pt-3" : "mt-2.5 sm:mt-3"}
      style={
        isEmbedded
          ? { borderColor: "color-mix(in srgb, var(--border-subtle) 72%, transparent)" }
          : undefined
      }
      aria-label={head}
    >
      {isEmbedded ? (
        <div className="mb-2 flex flex-col gap-1 sm:mb-2.5 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                className="text-[13px] font-semibold leading-snug tracking-[-0.03em] sm:text-[14px]"
                style={{ color: "var(--text-primary)" }}
              >
                {head}
              </h3>
              {routeActive ? (
                <span
                  className="shrink-0 rounded-full px-1.5 py-0.5 text-[7.5px] font-semibold uppercase tracking-[0.14em]"
                  style={{
                    color: "var(--text-tertiary)",
                    background: "color-mix(in srgb, var(--bg-muted) 35%, transparent)",
                  }}
                >
                  Keşif açık
                </span>
              ) : null}
            </div>
            {subtitle ? (
              <p
                className="mt-0.5 max-w-[40rem] line-clamp-1 text-[10.5px] font-medium leading-snug sm:line-clamp-none sm:text-[10.5px]"
                style={{ color: "var(--text-secondary)" }}
                title={subtitle}
              >
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] sm:text-[9.5px]" style={{ color: "var(--accent-blue)" }}>
            {head}
          </p>
          {subtitle ? (
            <p className="mt-0.5 text-[9.5px] leading-snug sm:text-[10px]" style={{ color: "var(--text-tertiary)" }}>
              {subtitle}
            </p>
          ) : null}
        </>
      )}
      <ul
        className={`list-none p-0 ${
          isEmbedded
            ? "mt-0 flex flex-col gap-1.5 sm:flex-row sm:gap-1.5"
            : `grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-2.5 ${subtitle ? "mt-1.5" : "mt-1"}`
        }`}
      >
        {items.map(({ fund, tag, micro, pickHint }, index) => {
          const rank = index + 1;
          const linkLabel = `${rank}. sıra — ${legalDisplayName(fund)} (${tag})`;
          return (
            <li key={fund.fundId} className={isEmbedded ? "flex min-h-0 min-w-0 flex-1" : undefined}>
              <Link
                href={fundDetailHref(fund.code)}
                prefetch={false}
                aria-label={isEmbedded ? linkLabel : undefined}
                className={`group relative flex overflow-hidden rounded-[11px] border outline-none transition-[transform,box-shadow,border-color,background-color] duration-[280ms] ease-out motion-reduce:transition-none ${
                  isEmbedded
                    ? "featured-discovery-tile h-full min-h-0 w-full flex-row items-start gap-2 px-2.5 py-1.5 sm:gap-2.5 sm:px-3 sm:py-2"
                    : `min-h-[2.65rem] items-center gap-2.5 px-2.5 py-2 sm:min-h-[3.35rem] ${sig ? "sm:min-h-[3.5rem]" : ""}`
                } hover:-translate-y-px motion-reduce:hover:translate-y-0`}
              >
                {isEmbedded ? (
                  <>
                    <span
                      className="featured-discovery-tile__accent pointer-events-none absolute left-0 top-2 bottom-2 z-[2] w-[2px] origin-center scale-y-[0.22] rounded-full opacity-0 transition-[opacity,transform] duration-[280ms] ease-[cubic-bezier(0.33,1,0.68,1)] group-hover:scale-y-100 group-hover:opacity-100 group-focus-visible:scale-y-100 group-focus-visible:opacity-100 motion-reduce:transition-none sm:top-2.5 sm:bottom-2.5"
                      aria-hidden
                    />
                    <span
                      className="featured-discovery-tile__veil pointer-events-none absolute inset-0 z-[1] opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
                      aria-hidden
                    />
                  </>
                ) : null}

                {isEmbedded ? (
                  <>
                    <div className="relative z-[1] shrink-0">
                      <FundLogoMark
                        code={fund.code}
                        logoUrl={fund.logoUrl}
                        wrapperClassName="flex h-11 w-11 items-center justify-center overflow-hidden rounded-[10px] border"
                        wrapperStyle={{
                          borderColor: "var(--mfc-border)",
                          background: "var(--logo-plate-gradient)",
                          color: "var(--mfc-secondary)",
                        }}
                        imgClassName="h-full w-full object-contain p-[0.2rem]"
                        initialsClassName="font-semibold tracking-tight tabular-nums text-[8px]"
                      />
                    </div>
                    <div className="relative z-[1] min-w-0 flex-1">
                      <p
                        className="text-[9.5px] font-bold uppercase tracking-[0.09em] tabular-nums sm:text-[10px]"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {fund.code}
                      </p>
                      {pickHint ? (
                        <p
                          className="mt-0.5 text-[7.5px] font-semibold uppercase leading-tight tracking-[0.13em] sm:text-[8px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {pickHint}
                        </p>
                      ) : null}
                      <p
                        className={`line-clamp-2 text-[11px] font-semibold leading-[1.26] tracking-[-0.015em] sm:text-[11.5px] ${pickHint ? "mt-0.5" : "mt-1"}`}
                        style={{ color: "var(--text-primary)" }}
                        title={legalDisplayName(fund)}
                      >
                        {legalDisplayName(fund)}
                      </p>
                      {micro ? (
                        <p
                          className="mt-0.5 line-clamp-1 text-[9.5px] font-medium leading-snug sm:mt-1 sm:text-[10px]"
                          style={{ color: "var(--text-secondary)" }}
                          title={micro}
                        >
                          {micro}
                        </p>
                      ) : null}
                      <div
                        className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-dashed pt-1.5 tabular-nums"
                        style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 65%, transparent)" }}
                      >
                        <span
                          className="text-[9.5px] font-semibold sm:text-[10px]"
                          style={{
                            color: daily1gMutedColor(fund.dailyReturn),
                          }}
                        >
                          1G {fmt1g(fund.dailyReturn)}
                        </span>
                        <span className="text-[9.5px] font-medium sm:text-[10px]" style={{ color: "var(--text-primary)" }}>
                          {formatFundLastPrice(fund.lastPrice)}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <FundLogoMark
                      code={fund.code}
                      logoUrl={fund.logoUrl}
                      wrapperClassName={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border ${sig ? "h-8 w-8" : "h-7 w-7"}`}
                      wrapperStyle={{
                        borderColor: "var(--mfc-border)",
                        background: "var(--logo-plate-gradient)",
                        color: "var(--mfc-secondary)",
                      }}
                      imgClassName="h-full w-full object-contain p-[0.2rem]"
                      initialsClassName={`font-semibold tracking-tight tabular-nums ${sig ? "text-[8px]" : "text-[7.5px]"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1.5">
                        <p
                          className={`min-w-0 flex-1 leading-snug ${sig ? "line-clamp-2 text-[11px] font-semibold" : "line-clamp-2 text-[10px] font-semibold"}`}
                          style={{ color: "var(--text-primary)" }}
                          title={legalDisplayName(fund)}
                        >
                          {legalDisplayName(fund)}
                        </p>
                        <span
                          className={`max-w-[5.5rem] shrink-0 truncate rounded px-1 py-0.5 font-semibold uppercase tracking-wide ${sig ? "text-[8px]" : "text-[7.5px]"}`}
                          style={{
                            color: "var(--text-tertiary)",
                            background: "color-mix(in srgb, var(--bg-muted) 50%, transparent)",
                          }}
                          title={tag}
                        >
                          {tag}
                        </span>
                      </div>
                      <div className={`flex items-center justify-between gap-2 tabular-nums ${sig ? "mt-1" : "mt-0.5"}`}>
                        <span
                          className={`font-semibold ${sig ? "text-[10px]" : "text-[9.5px]"}`}
                          style={{
                            color: daily1gMutedColor(fund.dailyReturn),
                          }}
                        >
                          1G {fmt1g(fund.dailyReturn)}
                        </span>
                        <span className={`font-medium ${sig ? "text-[10px]" : "text-[9.5px]"}`} style={{ color: "var(--text-primary)" }}>
                          {formatFundLastPrice(fund.lastPrice)}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

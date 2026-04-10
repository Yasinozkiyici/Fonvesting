import Link from "next/link";
import type { ReactNode } from "react";
import { FUND_THEMES, type FundThemeId } from "@/lib/fund-themes";
import type { FundIntentId } from "@/lib/fund-intents";

type Props = { activeIntent?: FundIntentId | null; activeTheme?: FundThemeId | null };

type ThemeVisual = {
  icon: ReactNode;
  accent: string;
  surface: string;
  border: string;
};

function ThemeIconFrame({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <span
      className="inline-flex h-[1.45rem] w-[1.45rem] shrink-0 items-center justify-center rounded-full border"
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 84%, transparent)",
        background: "color-mix(in srgb, var(--bg-muted) 82%, var(--card-bg))",
      }}
      aria-hidden
    >
      <svg viewBox="0 0 18 18" className="h-[11px] w-[11px]" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

const THEME_VISUALS: Record<FundThemeId, ThemeVisual> = {
  technology: {
    icon: (
      <ThemeIconFrame>
        <rect x="3.2" y="3.2" width="11.6" height="11.6" rx="2.4" />
        <path d="M6 1.9v2.4M12 1.9v2.4M6 13.7v2.4M12 13.7v2.4M1.9 6h2.4M13.7 6h2.4M1.9 12h2.4M13.7 12h2.4" />
        <path d="M6.2 6.3h5.6v5.4H6.2z" />
      </ThemeIconFrame>
    ),
    accent: "#6e86ab",
    surface: "color-mix(in srgb, #6e86ab 7%, var(--card-bg))",
    border: "color-mix(in srgb, #6e86ab 20%, var(--border-subtle))",
  },
  artificial_intelligence: {
    icon: (
      <ThemeIconFrame>
        <path d="M6.1 6.1a2.6 2.6 0 0 1 4.5-1.7 2.3 2.3 0 0 1 2.6 3 2.55 2.55 0 0 1-.2 5.1H6.3a2.4 2.4 0 0 1-.2-4.8Z" />
        <path d="M9 6.1v5.8M6.8 8.3H9M9 9.6h2.5" />
        <circle cx="12.8" cy="5.2" r="0.85" />
      </ThemeIconFrame>
    ),
    accent: "#7e8fae",
    surface: "color-mix(in srgb, #7e8fae 7%, var(--card-bg))",
    border: "color-mix(in srgb, #7e8fae 20%, var(--border-subtle))",
  },
  green_energy: {
    icon: (
      <ThemeIconFrame>
        <path d="M13.8 4.3c-4.3.2-7.1 2.3-8.6 6.2 2.4.8 4.8.4 6.6-1.2 1.5-1.3 2.2-3 2-5Z" />
        <path d="M6.2 9.9c1.4-.3 2.9-.2 4.4.2M9 8.7v5.3" />
        <path d="M11.8 12.8c-.8.9-1.7 1.5-2.8 1.8" />
      </ThemeIconFrame>
    ),
    accent: "#7ea485",
    surface: "color-mix(in srgb, #7ea485 9%, var(--card-bg))",
    border: "color-mix(in srgb, #7ea485 22%, var(--border-subtle))",
  },
  blockchain: {
    icon: (
      <ThemeIconFrame>
        <rect x="3.3" y="6.1" width="4.2" height="4.2" rx="1.1" />
        <rect x="10.5" y="3.3" width="4.2" height="4.2" rx="1.1" />
        <rect x="10.5" y="10.5" width="4.2" height="4.2" rx="1.1" />
        <path d="M7.6 8.2h2M11.4 7.4v3.2" />
      </ThemeIconFrame>
    ),
    accent: "#8b8f9f",
    surface: "color-mix(in srgb, #8b8f9f 8%, var(--card-bg))",
    border: "color-mix(in srgb, #8b8f9f 22%, var(--border-subtle))",
  },
  precious_metals: {
    icon: (
      <ThemeIconFrame>
        <ellipse cx="7" cy="7.3" rx="3.6" ry="2.3" />
        <path d="M3.4 7.3v2.3c0 1.3 1.6 2.3 3.6 2.3s3.6-1 3.6-2.3V7.3" />
        <ellipse cx="11.4" cy="10.7" rx="3.2" ry="2.1" />
      </ThemeIconFrame>
    ),
    accent: "#b19563",
    surface: "color-mix(in srgb, #b19563 8%, var(--card-bg))",
    border: "color-mix(in srgb, #b19563 22%, var(--border-subtle))",
  },
  defense: {
    icon: (
      <ThemeIconFrame>
        <path d="M9 2.8 13.8 4.6v3.8c0 3.1-1.7 5.4-4.8 6.8-3.1-1.4-4.8-3.7-4.8-6.8V4.6Z" />
        <path d="M9 5.4v5.8" />
      </ThemeIconFrame>
    ),
    accent: "#7d8a9c",
    surface: "color-mix(in srgb, #7d8a9c 7%, var(--card-bg))",
    border: "color-mix(in srgb, #7d8a9c 20%, var(--border-subtle))",
  },
  health_biotech: {
    icon: (
      <ThemeIconFrame>
        <path d="M7.2 3.6h3.6v3.2H14v3.6h-3.2v3.2H7.2v-3.2H4V6.8h3.2Z" />
        <circle cx="12.8" cy="12.8" r="1.1" />
      </ThemeIconFrame>
    ),
    accent: "#7f9995",
    surface: "color-mix(in srgb, #7f9995 7%, var(--card-bg))",
    border: "color-mix(in srgb, #7f9995 20%, var(--border-subtle))",
  },
};

function themeHref(id: FundThemeId, activeTheme?: FundThemeId | null): string {
  if (activeTheme === id) return "/";
  return `/?theme=${id}`;
}

export function InvestorIntentStrip({ activeIntent: _activeIntent = null, activeTheme = null }: Props) {
  return (
    <section className="mt-4 pt-3 sm:mt-5 sm:pt-4" aria-label="Temalara göre keşif">
      <div
        className="rounded-[22px] border px-4 py-2 sm:px-4.5 sm:py-2.5"
        style={{
          borderColor: "var(--border-subtle)",
          background: "color-mix(in srgb, var(--card-bg) 94%, var(--bg-muted))",
          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
        }}
      >
        <div className="mx-auto flex max-w-[1320px] flex-col gap-1.5">
          <div className="flex flex-col gap-1.5 lg:flex-row lg:items-end lg:justify-between lg:gap-4">
            <div className="min-w-0 max-w-[40rem]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
                Keşif
              </p>
              <h2 className="mt-0.5 text-[17px] font-semibold tracking-[-0.04em] sm:text-[19px]" style={{ color: "var(--text-primary)" }}>
                Temalara göre keşfet
              </h2>
              <p className="mt-0.5 max-w-[38rem] text-[12px] leading-snug sm:text-[13px]" style={{ color: "var(--text-secondary)" }}>
                Fonları öne çıkan yatırım temalarına göre filtrele.
              </p>
            </div>
            {activeTheme ? (
              <div
                className="inline-flex items-center gap-2 self-start rounded-full border px-2.5 py-1 text-[10px] sm:text-[11px]"
                style={{
                  borderColor: "color-mix(in srgb, var(--accent-blue) 18%, var(--border-subtle))",
                  background: "color-mix(in srgb, var(--accent-blue) 6%, var(--card-bg))",
                  color: "var(--text-secondary)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35)",
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent-blue)" }} aria-hidden />
                <span style={{ color: "var(--text-muted)" }}>Aktif tema</span>
                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                  {FUND_THEMES.find((item) => item.id === activeTheme)?.label}
                </span>
              </div>
            ) : null}
          </div>

          <div className="min-w-0">
            <ul
              className="grid grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-4 xl:grid-cols-7"
              style={{ alignItems: "stretch" }}
            >
            {FUND_THEMES.map((item) => {
              const active = item.id === activeTheme;
              const visual = THEME_VISUALS[item.id];
              return (
                <li key={item.id}>
                  <Link
                    href={themeHref(item.id, activeTheme)}
                    prefetch={false}
                    className="group flex h-[42px] w-full items-center gap-1.5 rounded-[14px] border px-2.5 py-1 text-[11px] font-medium tracking-[-0.01em] transition-[color,border-color,background-color,box-shadow] hover:text-[var(--text-primary)] sm:px-3 sm:text-[12px] xl:h-[38px] xl:px-2.5"
                    style={{
                      borderColor: active ? visual.border : "color-mix(in srgb, var(--border-subtle) 94%, var(--text-primary) 6%)",
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                      background: active ? visual.surface : "color-mix(in srgb, var(--card-bg) 92%, var(--bg-muted))",
                      boxShadow: active
                        ? "inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 2px rgba(15, 23, 42, 0.05)"
                        : "inset 0 1px 0 rgba(255,255,255,0.16)",
                    }}
                    aria-current={active ? "true" : undefined}
                    title={item.shortHint}
                  >
                    <span
                      className="shrink-0 transition-[color,border-color,background-color]"
                      style={{
                        color: active ? visual.accent : "var(--text-tertiary)",
                        transform: "scale(0.92)",
                      }}
                      aria-hidden
                    >
                      {visual.icon}
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="leading-tight xl:text-[11px] xl:whitespace-nowrap"
                        style={{ fontWeight: active ? 670 : 590 }}
                      >
                        {item.label}
                      </span>
                      {active ? (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: visual.accent, boxShadow: `0 0 0 3px color-mix(in srgb, ${visual.accent} 14%, transparent)` }}
                          aria-hidden
                        />
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

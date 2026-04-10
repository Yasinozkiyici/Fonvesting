import Link from "next/link";
import Header from "@/components/Header";
import { SitePageShell } from "@/components/SitePageShell";
import Footer from "@/components/tefas/Footer";
import type { StaticPageDef } from "@/content/static-pages";

function SectionBlock({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl border px-5 py-5 sm:px-6 sm:py-5"
      style={{
        borderColor: "var(--border-subtle)",
        background: "var(--card-bg)",
        boxShadow: "var(--shadow-xs, none)",
      }}
    >
      <h2
        className="text-[13px] font-semibold tracking-[-0.02em] sm:text-sm"
        style={{ color: "var(--text-primary)" }}
      >
        {heading}
      </h2>
      <div
        className="mt-3 space-y-2.5 text-sm leading-relaxed"
        style={{ color: "var(--text-secondary)" }}
      >
        {children}
      </div>
    </section>
  );
}

type StaticPageShellProps = {
  page: StaticPageDef;
  relatedLinks?: Array<{ href: string; label: string }>;
};

export function StaticPageShell({ page, relatedLinks }: StaticPageShellProps) {
  return (
    <SitePageShell>
      <Header />

      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 py-10 sm:px-6 lg:px-8">
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "var(--text-muted)" }}
        >
          {page.kicker}
        </p>
        <h1
          className="mt-2 text-2xl font-semibold tracking-tight sm:text-[1.65rem]"
          style={{ color: "var(--text-primary)" }}
        >
          {page.title}
        </h1>
        {page.heroDescription ? (
          <p
            className="mt-3 text-[14px] leading-relaxed sm:text-[15px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {page.heroDescription}
          </p>
        ) : null}

        <div className="mt-8 space-y-4 sm:mt-9 sm:space-y-5">
          {page.sections.map((section) => (
            <SectionBlock key={section.heading} heading={section.heading}>
              {section.paragraphs.map((p, i) => (
                <p key={`${section.heading}-${i}`}>{p}</p>
              ))}
            </SectionBlock>
          ))}
        </div>

        {page.closingText ? (
          <p
            className="mt-8 text-[13px] leading-relaxed sm:mt-9 sm:text-[14px]"
            style={{ color: "var(--text-tertiary)" }}
          >
            {page.closingText}
          </p>
        ) : null}

        {relatedLinks && relatedLinks.length > 0 ? (
          <nav
            className="mt-10 border-t pt-6 text-[12px] leading-relaxed sm:text-[13px]"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-muted)",
            }}
            aria-label="İlgili sayfalar"
          >
            <span
              className="font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              İlgili:{" "}
            </span>
            {relatedLinks.map((item, i) => (
              <span key={item.href}>
                {i > 0 ? " · " : null}
                <Link
                  href={item.href}
                  prefetch={false}
                  className="font-medium underline-offset-2 transition-opacity hover:opacity-80 hover:underline"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {item.label}
                </Link>
              </span>
            ))}
          </nav>
        ) : null}
      </main>

      <Footer />
    </SitePageShell>
  );
}

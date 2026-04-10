import type { ReactNode } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import { SitePageShell } from "@/components/SitePageShell";
import Footer from "@/components/tefas/Footer";
import { trustCrossLinks } from "@/content/trust-pages";

function TrustSectionBlock({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section
      className="rounded-xl border px-5 py-5 sm:px-6 sm:py-5"
      style={{
        borderColor: "var(--border-subtle)",
        background: "var(--card-bg)",
        boxShadow: "var(--shadow-xs, none)",
      }}
    >
      <h2 className="text-[13px] font-semibold tracking-[-0.02em] sm:text-sm" style={{ color: "var(--text-primary)" }}>
        {heading}
      </h2>
      <div className="mt-3 space-y-2.5 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {children}
      </div>
    </section>
  );
}

type TrustPageShellProps = {
  kicker: string;
  title: string;
  sections: Array<{ heading: string; paragraphs: string[] }>;
  /** Mevcut sayfa path’i — çapraz linklerde atlanır */
  currentPath: string;
};

export function TrustPageShell({ kicker, title, sections, currentPath }: TrustPageShellProps) {
  const related = trustCrossLinks.filter((l) => l.href !== currentPath);

  return (
    <SitePageShell>
        <Header />

        <main className="mx-auto w-full max-w-[720px] flex-1 px-4 py-10 sm:px-6 lg:px-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
            {kicker}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-[1.65rem]" style={{ color: "var(--text-primary)" }}>
            {title}
          </h1>

          <div className="mt-8 space-y-4 sm:mt-9 sm:space-y-5">
            {sections.map((section) => (
              <TrustSectionBlock key={section.heading} heading={section.heading}>
                {section.paragraphs.map((p, i) => (
                  <p key={`${section.heading}-${i}`}>{p}</p>
                ))}
              </TrustSectionBlock>
            ))}
          </div>

          <nav
            className="mt-10 border-t pt-6 text-[12px] leading-relaxed sm:text-[13px]"
            style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
            aria-label="İlgili güven sayfaları"
          >
            <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
              İlgili:{" "}
            </span>
            {related.map((item, i) => (
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
            {" · "}
            <Link
              href="/how-it-works"
              prefetch={false}
              className="font-medium underline-offset-2 transition-opacity hover:opacity-80 hover:underline"
              style={{ color: "var(--text-secondary)" }}
            >
              Nasıl çalışır?
            </Link>
          </nav>
        </main>

        <Footer />
    </SitePageShell>
  );
}

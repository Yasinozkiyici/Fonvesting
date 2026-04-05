"use client";

import Link from "next/link";
import { ExternalLink, Mail, ShieldCheck } from "lucide-react";
import { SiteLogo } from "@/components/SiteLogo";

const PRODUCT_LINKS = [
  { href: "/", label: "Piyasalar" },
  { href: "/stocks", label: "Fonlar" },
  { href: "/sectors", label: "Kategoriler" },
  { href: "/indices", label: "Fon Türleri" },
];

const RESOURCE_LINKS = [
  { href: "/diagnostics", label: "Metodoloji" },
  { href: "/status", label: "Veri Durumu" },
  { href: "/diagnostics", label: "SSS" },
  { href: "https://www.fundturkiye.gov.tr", label: "Veri Kaynağı", external: true },
];

const COMPANY_LINKS = [
  { href: "/status", label: "Hakkında" },
  { href: "mailto:hello@yatirim.io", label: "İletişim", external: true },
  { href: "/status", label: "Gizlilik" },
  { href: "/status", label: "Şartlar" },
];

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer
      className="mt-8 border-t sm:mt-10"
      style={{
        borderColor: "var(--border-subtle)",
        background: "var(--bg-muted)",
      }}
    >
      <div className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="grid gap-6 sm:gap-8 lg:grid-cols-[1.35fr_1fr_1fr_1fr]">
          <div className="max-w-md">
            <div className="flex items-center gap-2.5">
              <SiteLogo size="footer" />
              <span
                className="inline-flex rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em]"
                style={{ borderColor: "var(--border-subtle)", background: "var(--surface-glass)", color: "var(--text-tertiary)" }}
              >
                Araştırma
              </span>
            </div>
            <p className="mt-2.5 text-[12px] leading-relaxed sm:text-[13px]" style={{ color: "var(--text-secondary)" }}>
              TEFAS verileriyle sıralama ve risk görünümleri. Bilgilendirme amaçlıdır; yatırım önerisi değildir.
            </p>

            <div
              className="mt-4 rounded-lg border px-3 py-2.5"
              style={{
                borderColor: "var(--border-subtle)",
                background: "var(--surface-glass)",
              }}
            >
              <div className="flex items-start gap-2">
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border"
                  style={{ borderColor: "var(--border-subtle)", background: "var(--surface-glass-strong)", color: "var(--text-tertiary)" }}
                >
                  <ShieldCheck className="h-3 w-3" strokeWidth={2} />
                </div>
                <div>
                  <p className="text-[11px] font-semibold leading-snug sm:text-xs" style={{ color: "var(--text-primary)" }}>
                    Yatırım tavsiyesi değildir.
                  </p>
                  <p className="mt-0.5 text-[10px] leading-snug sm:text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    Kararlarınızı risk profilinize ve uzman görüşüne dayandırın.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <FooterLinkGroup title="Ürün" links={PRODUCT_LINKS} />
          <FooterLinkGroup title="Kaynaklar" links={RESOURCE_LINKS} />
          <FooterLinkGroup title="Şirket / İletişim" links={COMPANY_LINKS} />
        </div>

        <div
          className="mt-6 flex flex-col gap-2 border-t pt-4 text-[12px] sm:flex-row sm:items-center sm:justify-between sm:text-[13px]"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
        >
          <p>© {currentYear} Yatirim.io</p>
          <div className="inline-flex items-center gap-2" style={{ color: "var(--text-tertiary)" }}>
            <Mail className="h-4 w-4" />
            <a href="mailto:hello@yatirim.io" className="transition-colors hover:text-[var(--accent)]">
              hello@yatirim.io
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterLinkGroup({
  title,
  links,
}: {
  title: string;
  links: Array<{ href: string; label: string; external?: boolean }>;
}) {
  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      <ul className="mt-2.5 space-y-2 sm:mt-3 sm:space-y-2.5">
        {links.map((link) => (
          <li key={`${title}-${link.label}`}>
            {link.external ? (
              <a
                href={link.href}
                target={link.href.startsWith("http") ? "_blank" : undefined}
                rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-[var(--accent)]"
                style={{ color: "var(--text-secondary)" }}
              >
                {link.label}
                {link.href.startsWith("http") ? <ExternalLink className="h-3.5 w-3.5 opacity-70" /> : null}
              </a>
            ) : (
              <Link href={link.href} className="text-sm font-medium transition-colors hover:text-[var(--accent)]" style={{ color: "var(--text-secondary)" }}>
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

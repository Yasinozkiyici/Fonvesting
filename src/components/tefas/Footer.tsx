"use client";

import Link from "next/link";
import { Github, Twitter } from "lucide-react";
import { SiteLogo } from "@/components/SiteLogo";

const PRODUCT_LINKS = [
  { href: "/", label: "Fonlar" },
  { href: "/sectors", label: "Kategoriler" },
  { href: "/compare", label: "Karşılaştırma" },
];

const CORPORATE_LINKS = [
  { href: "/hakkimizda", label: "Hakkımızda" },
  { href: "/vizyonumuz", label: "Vizyonumuz" },
  { href: "/iletisim", label: "İletişim" },
];

const LEGAL_LINKS = [
  { href: "/sorumluluk-reddi", label: "Sorumluluk Reddi" },
  { href: "/gizlilik-politikasi", label: "Gizlilik Politikası" },
  { href: "/kullanim-kosullari", label: "Kullanım Koşulları" },
];

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer
      className="mt-8 border-t sm:mt-10"
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 88%, transparent)",
        background: "color-mix(in srgb, var(--bg-muted) 72%, var(--text-primary) 5%)",
      }}
    >
      <div className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="grid gap-6 sm:grid-cols-2 sm:gap-8 lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:gap-10">
          <div className="max-w-xs">
            <SiteLogo size="footer" />
            <p
              className="mt-3 text-[12px] leading-relaxed sm:text-[13px]"
              style={{ color: "var(--text-secondary)" }}
            >
              Türkiye&apos;deki yatırım fonlarını daha net keşfetmek, karşılaştırmak
              ve takip etmek için tasarlanmış sade bir deneyim.
            </p>
            <p
              className="mt-3 text-[11px] leading-snug"
              style={{ color: "var(--text-tertiary)" }}
            >
              Bilgilendirme amaçlıdır. Yatırım tavsiyesi değildir.
            </p>
          </div>

          <FooterLinkGroup title="Ürün" links={PRODUCT_LINKS} />
          <div>
            <FooterLinkGroup title="Kurumsal" links={CORPORATE_LINKS} />
            <div className="mt-3 flex items-center gap-3">
              <a
                href="https://x.com/getyatirim"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[13px] font-medium transition-colors hover:text-[var(--text-primary)]"
                style={{ color: "var(--text-secondary)" }}
                aria-label="X (Twitter)"
              >
                <Twitter className="h-3.5 w-3.5" strokeWidth={2} />
                <span>X</span>
              </a>
              <a
                href="https://github.com/yatirimio"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[13px] font-medium transition-colors hover:text-[var(--text-primary)]"
                style={{ color: "var(--text-secondary)" }}
                aria-label="GitHub"
              >
                <Github className="h-3.5 w-3.5" strokeWidth={2} />
                <span>GitHub</span>
              </a>
            </div>
          </div>
          <FooterLinkGroup title="Yasal" links={LEGAL_LINKS} />
        </div>

        <div
          className="mt-6 flex flex-col gap-3 border-t pt-4 text-[11px] sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:text-[12px]"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-tertiary)" }}
        >
          <p>© {currentYear} Yatirim.io. Tüm hakları saklıdır.</p>
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <a
              href="mailto:hello@yatirim.io"
              className="transition-colors hover:text-[var(--text-secondary)]"
            >
              hello@yatirim.io
            </a>
            <a
              href="https://x.com/getyatirim"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 transition-colors hover:text-[var(--text-secondary)]"
              aria-label="X (Twitter)"
            >
              <Twitter className="h-3.5 w-3.5" strokeWidth={2} />
            </a>
            <a
              href="https://github.com/yatirimio"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 transition-colors hover:text-[var(--text-secondary)]"
              aria-label="GitHub"
            >
              <Github className="h-3.5 w-3.5" strokeWidth={2} />
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
      <h3
        className="text-[10px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: "var(--text-muted)" }}
      >
        {title}
      </h3>
      <ul className="mt-2.5 space-y-1.5 sm:mt-3 sm:space-y-2">
        {links.map((link) => (
          <li key={`${title}-${link.href}-${link.label}`}>
            {link.external ? (
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] font-medium transition-colors hover:text-[var(--text-primary)]"
                style={{ color: "var(--text-secondary)" }}
              >
                {link.label}
              </a>
            ) : (
              <Link
                href={link.href}
                prefetch={false}
                className="text-[13px] font-medium transition-colors hover:text-[var(--text-primary)]"
                style={{ color: "var(--text-secondary)" }}
              >
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

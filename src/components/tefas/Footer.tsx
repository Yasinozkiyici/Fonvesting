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

type FooterProps = {
  /** Fon detay: daha kompakt spacing + `site-footer--detail` (globals). Ana sayfa: `default`. */
  variant?: "default" | "detail";
};

export default function Footer({ variant = "default" }: FooterProps) {
  const currentYear = new Date().getFullYear();
  const detail = variant === "detail";

  return (
    <footer
      className={`site-footer border-t ${detail ? "site-footer--detail mt-8 sm:mt-9" : "mt-9 sm:mt-10"}`}
    >
      <div
        className={`site-footer__inner mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8 ${detail ? "py-5 sm:py-6" : "py-6 sm:py-7"}`}
      >
        <div className={`grid sm:grid-cols-2 lg:grid-cols-[1.45fr_1fr_1fr_1fr] ${detail ? "gap-5 sm:gap-7 lg:gap-9" : "gap-6 sm:gap-8 lg:gap-10"}`}>
          <div className="max-w-sm">
            <SiteLogo size="footer" />
            <p className="site-footer__lede mt-3 text-[12px] leading-relaxed sm:text-[13px]">
              Türkiye&apos;deki yatırım fonlarını daha net keşfetmek, karşılaştırmak
              ve takip etmek için tasarlanmış sade bir deneyim.
            </p>
            <p className="site-footer__disclaimer mt-3 text-[11px] leading-snug">
              Bilgilendirme amaçlıdır. Yatırım tavsiyesi değildir.
            </p>
          </div>

          <FooterLinkGroup title="Ürün" links={PRODUCT_LINKS} />
          <div>
            <FooterLinkGroup title="Kurumsal" links={CORPORATE_LINKS} />
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <a
                href="https://x.com/getyatirim"
                target="_blank"
                rel="noopener noreferrer"
                className="site-footer__social inline-flex items-center gap-1.5 text-[13px] font-medium"
                aria-label="X (Twitter)"
              >
                <Twitter className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                <span>X</span>
              </a>
              <a
                href="https://github.com/yatirimio"
                target="_blank"
                rel="noopener noreferrer"
                className="site-footer__social inline-flex items-center gap-1.5 text-[13px] font-medium"
                aria-label="GitHub"
              >
                <Github className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                <span>GitHub</span>
              </a>
            </div>
          </div>
          <FooterLinkGroup title="Yasal" links={LEGAL_LINKS} />
        </div>

        <div
          className={`site-footer__rule flex flex-col border-t text-[11px] sm:flex-row sm:items-center sm:justify-between sm:text-[12px] ${
            detail ? "mt-5 gap-1.5 pt-3.5 sm:mt-6 sm:gap-2.5 sm:pt-4" : "mt-6 gap-2 pt-4 sm:mt-7 sm:gap-3 sm:pt-5"
          }`}
        >
          <p className="site-footer__copyright tabular-nums">© {currentYear} Yatirim.io. Tüm hakları saklıdır.</p>
          <div className={`flex flex-wrap items-center sm:justify-end ${detail ? "gap-x-2.5 gap-y-1" : "gap-x-3 gap-y-1.5"}`}>
            <a href="mailto:hello@yatirim.io" className="site-footer__mail text-[11px] font-medium tabular-nums sm:text-[12px]">
              hello@yatirim.io
            </a>
            <div className="flex items-center gap-2">
              <a
                href="https://x.com/getyatirim"
                target="_blank"
                rel="noopener noreferrer"
                className="site-footer__iconbtn inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors"
                aria-label="X (Twitter)"
              >
                <Twitter className="h-3.5 w-3.5" strokeWidth={2} />
              </a>
              <a
                href="https://github.com/yatirimio"
                target="_blank"
                rel="noopener noreferrer"
                className="site-footer__iconbtn inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors"
                aria-label="GitHub"
              >
                <Github className="h-3.5 w-3.5" strokeWidth={2} />
              </a>
            </div>
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
      <h3 className="site-footer__group-title text-[10px] font-semibold uppercase tracking-[0.12em]">{title}</h3>
      <ul className="mt-2.5 space-y-2 sm:mt-3 sm:space-y-2.5">
        {links.map((link) => (
          <li key={`${title}-${link.href}-${link.label}`}>
            {link.external ? (
              <a href={link.href} target="_blank" rel="noopener noreferrer" className="site-footer__link text-[13px] font-medium">
                {link.label}
              </a>
            ) : (
              <Link href={link.href} prefetch={false} className="site-footer__link text-[13px] font-medium">
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

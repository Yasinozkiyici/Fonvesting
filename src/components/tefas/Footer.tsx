"use client";

import { ExternalLink, Github, Twitter, Linkedin } from "lucide-react";
import { SiteLogo } from "@/components/SiteLogo";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  const resources = [
    { href: "https://www.fundturkiye.gov.tr", label: "TEFAS" },
    { href: "https://www.fonbul.fonapi.com", label: "Fon Bilgileri" },
    { href: "https://www.spk.gov.tr", label: "SPK" },
    { href: "https://www.kap.org.tr", label: "KAP" },
  ];

  return (
    <footer
      className="mt-auto border-t transition-colors"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface)" }}
    >
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 py-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="mb-4 flex items-center gap-2">
              <SiteLogo size="footer" />
              <span
                className="rounded-md px-2 py-0.5 text-2xs font-semibold uppercase"
                style={{ background: "var(--accent-bg)", color: "var(--accent)" }}
              >
                TEFAS
              </span>
            </div>
            <p className="mb-5 max-w-sm text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Yatırım fonu fiyatları, günlük getiri ve portföy metrikleri. Veriler senkron script ile güncellenir; yatırım
              tavsiyesi değildir.
            </p>
            <div className="flex items-center gap-2">
              {[Twitter, Linkedin, Github].map((Icon, i) => (
                <div
                  key={i}
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{
                    background: "var(--bg-hover)",
                    border: "1px solid var(--border-subtle)",
                    color: "var(--text-muted)",
                  }}
                >
                  <Icon className="h-4 w-4" />
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-caption mb-3">Kaynaklar</h4>
            <ul className="space-y-2.5">
              {resources.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-center gap-1.5 text-sm transition-colors"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {link.label}
                    <ExternalLink className="h-3 w-3 opacity-60 transition group-hover:opacity-100" />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-caption mb-3">Yasal uyarı</h4>
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Gösterilen veriler bilgilendirme amaçlıdır. Fon seçimi ve riskler için yönetim şirketi veya lisanslı danışmana
              başvurun.
            </p>
          </div>
        </div>

        <div className="border-t py-4" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              © {currentYear} Yatirim.io
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

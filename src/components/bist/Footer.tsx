"use client";

import { ExternalLink, Github, Twitter, Linkedin } from "lucide-react";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  const resources = [
    { href: "https://www.borsaistanbul.com", label: "Borsa İstanbul" },
    { href: "https://www.kap.org.tr", label: "KAP" },
    { href: "https://www.tcmb.gov.tr", label: "TCMB" },
    { href: "https://www.spk.gov.tr", label: "SPK" },
  ];

  return (
    <footer 
      className="mt-auto border-t transition-colors"
      style={{ 
        borderColor: 'var(--border-subtle)', 
        background: 'var(--bg-surface)' 
      }}
    >
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        {/* Main Footer */}
        <div className="py-10 grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <img
                src="/images/bistmarketcap-logo.png"
                alt="BISTMarketCap"
                className="h-8 w-auto"
              />
            </div>
            <p 
              className="text-sm leading-relaxed max-w-sm mb-5"
              style={{ color: 'var(--text-muted)' }}
            >
              Borsa İstanbul hisse senetleri ve piyasa verileri platformu. Gerçek zamanlı fiyatlar, 
              endeksler ve sektör analizleri ile yatırım kararlarınızı destekleyin.
            </p>
            <div className="flex items-center gap-2">
              {[Twitter, Linkedin, Github].map((Icon, i) => (
                <button
                  key={i}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
                  style={{
                    background: 'var(--bg-hover)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-active)';
                    e.currentTarget.style.borderColor = 'var(--border-default)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--bg-hover)';
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                    e.currentTarget.style.color = 'var(--text-muted)';
                  }}
                >
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
          </div>

          {/* Resources */}
          <div>
            <h4 className="text-caption mb-3">Kaynaklar</h4>
            <ul className="space-y-2.5">
              {resources.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm transition-colors group"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent)'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                  >
                    {link.label}
                    <ExternalLink className="w-3 h-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-caption mb-3">Yasal Uyarı</h4>
            <p 
              className="text-sm leading-relaxed"
              style={{ color: 'var(--text-muted)' }}
            >
              Bu platformda sunulan veriler yalnızca bilgilendirme amaçlıdır ve yatırım tavsiyesi 
              niteliği taşımaz. Yatırım kararlarınız için yetkili kuruluşlara danışınız.
            </p>
          </div>
        </div>

        {/* Bottom Bar */}
        <div 
          className="py-4 border-t"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              © {currentYear} BISTMarketCap. Tüm hakları saklıdır.
            </p>
            <div className="flex items-center gap-5">
              <a 
                href="#" 
                className="text-xs transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                Gizlilik Politikası
              </a>
              <a 
                href="#" 
                className="text-xs transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                Kullanım Koşulları
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

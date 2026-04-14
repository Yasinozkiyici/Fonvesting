import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ThemeProvider } from "@/context/ThemeContext";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import "./globals.css";

const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Yatirim.io — Yatırım fonları",
  description:
    "Türk yatırım fonlarını daha hızlı inceleyin, daha net karşılaştırın; teknik detayda kaybolmadan daha iyi kararlar için güncel fon verisi.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr" data-theme="light" className={fontSans.variable} suppressHydrationWarning>
      <head>
        {/* CSS gelmeden önce bile zemin + metin görünür olsun (FOUC / HMR boş ekran) */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              /* Tailwind/preflight gecikse bile sayfa çökmez (margin + kutu modeli) */
              *, *::before, *::after { box-sizing: border-box; }
              body { margin: 0; }
              html { background-color: #fdfdfb; color: #0c1628; }
              html[data-theme="dark"] { background-color: #0f1419; color: #e8eaed; }
            `,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme') || 'light';
                  if (theme !== 'light' && theme !== 'dark') theme = 'light';
                  document.documentElement.setAttribute('data-theme', theme);
                  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
                } catch (e) {
                  document.documentElement.setAttribute('data-theme', 'light');
                  document.documentElement.style.colorScheme = 'light';
                }
                try {
                  var m = window.matchMedia('(max-width: 767px)');
                  var syncNarrow = function() {
                    document.documentElement.setAttribute('data-viewport-narrow', m.matches ? '1' : '0');
                  };
                  syncNarrow();
                  if (m.addEventListener) m.addEventListener('change', syncNarrow);
                  else if (m.addListener) m.addListener(syncNarrow);
                } catch (e2) {
                  document.documentElement.setAttribute('data-viewport-narrow', '0');
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className="min-h-screen font-sans antialiased"
        style={{
          backgroundColor: "var(--bg-base, #fcfcfb)",
          color: "var(--text-primary, #0c1628)",
        }}
      >
        <ThemeProvider>
          <AppErrorBoundary>{children}</AppErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  );
}

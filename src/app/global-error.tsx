"use client";

import { useEffect } from "react";

const SHOW_DETAILS = process.env.NODE_ENV !== "production";

/**
 * Kök layout veya sağlayıcılarda oluşan hatalar `error.tsx` ile yakalanamaz.
 * Bu dosya tüm ağacı değiştirir; kendi html/body’sine ihtiyaç duyar.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (SHOW_DETAILS) {
      console.error("[global-error]", error);
    }
  }, [error]);

  return (
    <html lang="tr" data-theme="light">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme !== 'dark' && theme !== 'light') {
                    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                  }
                  document.documentElement.setAttribute('data-theme', theme);
                  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          backgroundColor: "var(--bg-base, #f4f4f1)",
          color: "var(--text-primary, #0c1628)",
        }}
      >
        <div style={{ maxWidth: "28rem", margin: "0 auto", padding: "2rem 1.25rem" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 0.75rem" }}>Uygulama yüklenemedi</h1>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.55, opacity: 0.85, margin: "0 0 1rem", color: "var(--text-secondary, #334b66)" }}>
            Uygulama kabuğu beklenmeyen bir durumda kaldı. Sayfayı yeniden deneyin; sorun sürerse biraz sonra tekrar
            kontrol edin.
          </p>
          {SHOW_DETAILS ? (
            <pre
              style={{
                fontSize: "0.75rem",
                padding: "0.75rem",
                borderRadius: 8,
                background: "var(--card-bg, #fff)",
                border: "1px solid var(--border-default, rgba(15,23,42,0.12))",
                overflow: "auto",
                maxHeight: "10rem",
              }}
            >
              {error.message}
            </pre>
          ) : null}
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                border: "none",
                borderRadius: 8,
                background: "var(--accent-blue, #2a6fd4)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Yeniden dene
            </button>
            <a
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid var(--border-default, rgba(15,23,42,0.15))",
                color: "var(--text-primary, #0c1628)",
                textDecoration: "none",
              }}
            >
              Ana sayfa
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}

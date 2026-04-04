"use client";

import { useEffect } from "react";

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
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          backgroundColor: "#f4f4f1",
          color: "#0c1628",
        }}
      >
        <div style={{ maxWidth: "28rem", margin: "0 auto", padding: "2rem 1.25rem" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 0.75rem" }}>Uygulama yüklenemedi</h1>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.55, opacity: 0.85, margin: "0 0 1rem" }}>
            Kök bileşende beklenmeyen bir hata oluştu. Geliştirme modunda konsolu (F12) kontrol edin; üretimde sayfayı
            yenileyin.
          </p>
          <pre
            style={{
              fontSize: "0.75rem",
              padding: "0.75rem",
              borderRadius: 8,
              background: "#fff",
              border: "1px solid rgba(15,23,42,0.12)",
              overflow: "auto",
              maxHeight: "10rem",
            }}
          >
            {error.message}
          </pre>
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
                background: "#2a6fd4",
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
                border: "1px solid rgba(15,23,42,0.15)",
                color: "#0c1628",
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

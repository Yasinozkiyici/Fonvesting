"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="tr">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", padding: 24, background: "#fff", color: "#111" }}>
        <h1 style={{ fontSize: 20 }}>Uygulama hatası</h1>
        <p style={{ fontSize: 14, opacity: 0.8 }}>{error.message}</p>
        <button type="button" style={{ marginTop: 16, padding: "8px 16px", cursor: "pointer" }} onClick={reset}>
          Yeniden dene
        </button>
      </body>
    </html>
  );
}

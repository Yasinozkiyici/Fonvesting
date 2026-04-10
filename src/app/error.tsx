"use client";

import { useEffect } from "react";
import Link from "next/link";

const SHOW_DETAILS = process.env.NODE_ENV !== "production";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (SHOW_DETAILS) {
      console.error("[route-error]", error);
    }
  }, [error]);

  return (
    <div
      className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6"
      style={{
        fontFamily: "var(--font-sans), system-ui, sans-serif",
        background: "var(--bg-base, #fcfcfb)",
        color: "var(--text-primary, #0c1628)",
      }}
    >
      <h1 className="text-xl font-semibold tracking-tight">Sayfa yüklenirken hata oluştu</h1>
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary, #334b66)" }}>
        Sayfa beklenmeyen bir durumda kaldı. Yeniden deneyin veya ana sayfaya dönün. Sorun sürerse sistem durumu ve veri
        akışını daha sonra tekrar kontrol edin.
      </p>
      {SHOW_DETAILS ? (
        <pre
          className="max-h-40 overflow-auto rounded-lg border p-3 text-xs"
          style={{
            borderColor: "var(--border-default, rgba(15,23,42,0.1))",
            background: "var(--card-bg, #fff)",
          }}
        >
          {error.message}
        </pre>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
          style={{ background: "var(--accent-blue, #2a6fd4)" }}
          onClick={reset}
        >
          Yeniden dene
        </button>
        <Link
          href="/"
          className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-semibold"
          style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
        >
          Ana sayfa
        </Link>
      </div>
    </div>
  );
}

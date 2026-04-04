"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6"
      style={{ fontFamily: "system-ui, sans-serif", background: "#f8f9fa", color: "#111827" }}
    >
      <h1 className="text-xl font-semibold">Sayfa yüklenirken hata oluştu</h1>
      <p className="text-sm opacity-80">
        Tarayıcı konsolunda (F12 → Console) ayrıntıya bakın. Ortam değişkenlerinde{" "}
        <code className="rounded bg-black/10 px-1">DATABASE_URL=file:./dev.db</code> olduğundan emin olun.
      </p>
      <pre className="max-h-40 overflow-auto rounded border border-black/10 bg-white p-3 text-xs">{error.message}</pre>
      <button
        type="button"
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
        onClick={reset}
      >
        Yeniden dene
      </button>
    </div>
  );
}

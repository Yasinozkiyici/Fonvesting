import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main
      className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6 py-10"
      style={{
        background: "var(--bg-base, #fdfdfb)",
        color: "var(--text-primary, #0c1628)",
      }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted, #6b86a6)" }}>
        404
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">Sayfa bulunamadı</h1>
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary, #334b66)" }}>
        İstenen içerik taşınmış olabilir veya route şu an mevcut olmayabilir.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link
          href="/"
          className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-semibold"
          style={{
            borderColor: "var(--border-default, rgba(15,23,42,0.1))",
            background: "var(--card-bg, #fff)",
            color: "var(--text-primary, #0c1628)",
          }}
        >
          Ana sayfaya dön
        </Link>
      </div>
    </main>
  );
}

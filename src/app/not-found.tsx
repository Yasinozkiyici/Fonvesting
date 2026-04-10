import Link from "next/link";
import { SitePageShell } from "@/components/SitePageShell";

export default function NotFound() {
  return (
    <SitePageShell>
      <main className="mx-auto flex min-h-screen w-full max-w-[1320px] items-center px-4 py-10 sm:px-6 lg:px-8">
        <section
          className="w-full max-w-xl rounded-2xl border px-5 py-6 sm:px-7 sm:py-7"
          style={{
            borderColor: "var(--border-subtle)",
            background: "var(--card-bg)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.14em] sm:text-[11px]"
            style={{ color: "var(--text-muted)" }}
          >
            404
          </p>
          <h1
            className="mt-2 text-[1.5rem] font-semibold tracking-[-0.03em] sm:text-[1.85rem]"
            style={{ color: "var(--text-primary)" }}
          >
            Sayfa bulunamadı
          </h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed sm:text-[15px]" style={{ color: "var(--text-secondary)" }}>
            İstenen içerik taşınmış olabilir, bağlantı eski olabilir veya sayfa şu an mevcut olmayabilir.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link
              href="/"
              prefetch={false}
              className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold"
              style={{
                background: "var(--accent-blue)",
                color: "#fff",
              }}
            >
              Ana sayfaya dön
            </Link>
            <Link
              href="/compare"
              prefetch={false}
              className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-semibold"
              style={{
                borderColor: "var(--border-default)",
                color: "var(--text-primary)",
                background: "var(--surface-glass)",
              }}
            >
              Karşılaştırmaya git
            </Link>
          </div>
        </section>
      </main>
    </SitePageShell>
  );
}

import type { NextPageContext } from "next";
import Link from "next/link";

type ErrorPageProps = {
  statusCode: number;
};

function getMessage(statusCode: number): string {
  if (statusCode === 404) {
    return "İstenen sayfa bulunamadı veya route geçici olarak yeniden derleniyor olabilir.";
  }

  if (statusCode >= 500) {
    return "Uygulama beklenmeyen bir hata verdi. Sayfayı yeniden deneyin veya ana sayfaya dönün.";
  }

  return "Beklenmeyen bir sayfa hatası oluştu.";
}

export default function ErrorPage({ statusCode }: ErrorPageProps) {
  return (
    <main
      className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6 py-10"
      style={{
        background: "var(--bg-base, #fdfdfb)",
        color: "var(--text-primary, #0c1628)",
      }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted, #6b86a6)" }}>
        Fallback
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        {statusCode === 404 ? "Sayfa bulunamadı" : "Arayüz şu an yüklenemedi"}
      </h1>
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary, #334b66)" }}>
        {getMessage(statusCode)}
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

ErrorPage.getInitialProps = ({ res, err }: NextPageContext): ErrorPageProps => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 500;
  return { statusCode };
};

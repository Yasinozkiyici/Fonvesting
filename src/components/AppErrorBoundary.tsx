"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

type Props = { children: ReactNode };

type State = { error: Error | null };
const SHOW_DETAILS = process.env.NODE_ENV !== "production";

/**
 * İstemci tarafı render sırasında yakalanmayan hatalar bazen boş/beyaz ekran bırakır.
 * Rota değişince (key) sınır sıfırlanır.
 */
class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (SHOW_DETAILS) {
      console.error("[AppErrorBoundary]", error, info.componentStack);
    }
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div
          className="mx-auto flex min-h-[50vh] max-w-lg flex-col justify-center gap-4 p-6"
          style={{
            background: "var(--bg-base, #fcfcfb)",
            color: "var(--text-primary, #0c1628)",
          }}
        >
          <h1 className="text-lg font-semibold tracking-tight">Arayüz yüklenirken hata oluştu</h1>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary, #334b66)" }}>
            Bu genelde geçici bir durumdur. Sayfayı yeniden deneyin veya ana sayfaya dönün. Sorun sürerse biraz sonra
            tekrar deneyin.
          </p>
          {SHOW_DETAILS ? (
            <pre
              className="max-h-32 overflow-auto rounded-lg border p-3 text-xs"
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
              onClick={() => this.setState({ error: null })}
            >
              Tekrar dene
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
    return this.props.children;
  }
}

export default function AppErrorBoundary({ children }: Props) {
  const pathname = usePathname();
  return (
    <ErrorBoundaryInner key={pathname ?? "/"}>{children}</ErrorBoundaryInner>
  );
}

"use client";

import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";

type Props = { fundCode: string };

/**
 * Ürün akışı (portföy / karşılaştırma / optimizer) henüz bağlı değil — sakin, ikincil eylem çerçevesi.
 */
export function FundDetailActions({ fundCode }: Props) {
  return (
    <section className="mt-8 sm:mt-10" aria-labelledby="fund-detail-actions-heading">
      <FundDetailSectionTitle id="fund-detail-actions-heading">İşlemler</FundDetailSectionTitle>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          disabled
          className="inline-flex min-h-[2.25rem] items-center justify-center rounded-lg border px-4 text-sm font-semibold tracking-[-0.02em] opacity-50"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-secondary)",
            background: "var(--card-bg)",
          }}
          title="Yakında"
        >
          Portföye ekle
        </button>
        <button
          type="button"
          disabled
          className="inline-flex min-h-[2.25rem] items-center justify-center rounded-lg border px-4 text-sm font-semibold tracking-[-0.02em] opacity-50"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-secondary)",
            background: "var(--card-bg)",
          }}
          title="Yakında"
        >
          Karşılaştırmaya ekle
        </button>
        <button
          type="button"
          disabled
          className="inline-flex min-h-[2.25rem] items-center justify-center rounded-lg border px-4 text-sm font-semibold tracking-[-0.02em] opacity-50"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-secondary)",
            background: "var(--card-bg)",
          }}
          title="Yakında"
        >
          Optimizer’da aç
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
        <span className="tabular-nums font-medium" style={{ color: "var(--text-tertiary)" }}>
          {fundCode}
        </span>{" "}
        için portföy ve optimizasyon akışları üzerinde çalışıyoruz; bağlandığında bu kısayollar etkinleşecek.
      </p>
    </section>
  );
}

"use client";

import Link from "next/link";
import { FundDetailSectionTitle } from "@/components/fund/FundDetailSectionTitle";

type Props = { fundCode: string };

export function FundDetailActions({ fundCode }: Props) {
  const listHref = `/?q=${encodeURIComponent(fundCode)}`;

  return (
    <section aria-labelledby="fund-detail-actions-heading">
      <FundDetailSectionTitle id="fund-detail-actions-heading">İşlemler</FundDetailSectionTitle>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed sm:text-sm" style={{ color: "var(--text-secondary)" }}>
        Araştırmayı portföy, karşılaştırma veya optimizer akışına taşımak için kısayollar yakında burada olacak.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          disabled
          className="inline-flex min-h-[2.25rem] cursor-not-allowed items-center justify-center rounded-lg border px-4 text-sm font-semibold tracking-[-0.02em]"
          style={{
            borderColor: "var(--border-subtle)",
            color: "var(--text-tertiary)",
            background: "var(--bg-muted)",
            opacity: 0.85,
          }}
          title="Yakında"
        >
          Portföye ekle
        </button>
        <button
          type="button"
          disabled
          className="inline-flex min-h-[2.25rem] cursor-not-allowed items-center justify-center rounded-lg border px-4 text-sm font-semibold tracking-[-0.02em]"
          style={{
            borderColor: "var(--border-subtle)",
            color: "var(--text-tertiary)",
            background: "var(--bg-muted)",
            opacity: 0.85,
          }}
          title="Yakında"
        >
          Karşılaştırmaya ekle
        </button>
        <button
          type="button"
          disabled
          className="inline-flex min-h-[2.25rem] cursor-not-allowed items-center justify-center rounded-lg border px-4 text-sm font-semibold tracking-[-0.02em]"
          style={{
            borderColor: "var(--border-subtle)",
            color: "var(--text-tertiary)",
            background: "var(--bg-muted)",
            opacity: 0.85,
          }}
          title="Yakında"
        >
          Optimizer’da aç
        </button>
      </div>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
        <Link href={listHref} className="font-medium transition-colors hover:opacity-80" style={{ color: "var(--accent)" }}>
          Ana listede bu kodu aç
        </Link>
        <span className="mx-1.5 opacity-40" aria-hidden>
          ·
        </span>
        <span className="tabular-nums" style={{ color: "var(--text-tertiary)" }}>
          {fundCode}
        </span>
      </p>
    </section>
  );
}

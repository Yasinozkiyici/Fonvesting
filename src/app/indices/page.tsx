"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/tefas/Footer";
import FundsTable from "@/components/tefas/FundsTable";

type TypeRow = {
  code: string;
  name: string;
  stockCount: number;
  value: number;
};

export default function IndicesPage() {
  const [types, setTypes] = useState<TypeRow[]>([]);

  useEffect(() => {
    fetch("/api/indices")
      .then((r) => r.json())
      .then((rows: TypeRow[]) => setTypes(rows))
      .catch(console.error);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="gradient-mesh">
        <div className="mesh-layer-1" />
        <div className="mesh-layer-2" />
        <div className="mesh-layer-3" />
        <div className="noise" />
      </div>

      <Header />

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            Fon türleri
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Yatırım fonları (0) ve emeklilik fonları (1) listelerini ayırın. Kartlardaki tutar toplam portföy büyüklüğüdür.
          </p>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {types.map((t) => (
            <Link
              key={t.code}
              href={`/indices?index=${encodeURIComponent(t.code)}`}
              className="rounded-xl border p-4 transition"
              style={{
                borderColor: "var(--border-default)",
                background: "var(--card-bg)",
                color: "var(--text-primary)",
              }}
            >
              <p className="text-sm font-semibold">{t.name}</p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {t.stockCount} fon
              </p>
              <p className="mt-2 text-sm tabular-nums" style={{ color: "var(--text-secondary)" }}>
                ₺{t.value.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}
              </p>
            </Link>
          ))}
        </div>

        <Suspense
          fallback={
            <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--border-default)", color: "var(--text-muted)" }}>
              Tablo yükleniyor...
            </div>
          }
        >
          <FundsTable />
        </Suspense>
      </main>

      <Footer />
    </div>
  );
}

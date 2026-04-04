"use client";

import { Suspense } from "react";
import Header from "@/components/Header";
import Footer from "@/components/tefas/Footer";
import FundsTable from "@/components/tefas/FundsTable";

export default function StocksPage() {
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
            Tüm fonlar
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            TEFAS’ta işlem gören yatırım fonlarını kategori ve türe göre filtreleyebilirsiniz.
          </p>
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

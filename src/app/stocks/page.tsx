"use client";

import { Suspense } from "react";
import Header from "@/components/Header";
import Footer from "@/components/tefas/Footer";
import FundsTable from "@/components/tefas/FundsTable";

export default function StocksPage() {
  return (
    <div className="relative isolate flex min-h-screen flex-col">
      <div className="gradient-mesh">
        <div className="mesh-layer-1" />
        <div className="mesh-layer-2" />
        <div className="mesh-layer-3" />
        <div className="noise" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
        <Header />

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:px-6 sm:py-8 sm:pb-8 lg:px-8">
          <div className="mb-4 sm:mb-6">
            <h1 className="text-xl font-semibold sm:text-2xl" style={{ color: "var(--text-primary)" }}>
              Tüm fonlar
            </h1>
            <p className="mt-1 text-xs sm:text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Hafta içi işlem. Günlük % son işlem günü ile bir önceki iş gününe göre; yalnızca güncel fiyat
              gösterilir.
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
    </div>
  );
}

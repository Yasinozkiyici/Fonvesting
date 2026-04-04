"use client";

import { Suspense } from "react";
import Header from "@/components/Header";
import MarketHeader from "@/components/tefas/MarketHeader";
import ScoredFundsTable from "@/components/tefas/ScoredFundsTable";
import Footer from "@/components/tefas/Footer";

export default function Page() {
  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      <div className="gradient-mesh">
        <div className="mesh-layer-1" />
        <div className="mesh-layer-2" />
        <div className="mesh-layer-3" />
        <div className="noise" />
      </div>

      <Header />

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <MarketHeader />

        <div id="funds-table" className="mt-6">
          <Suspense
            fallback={
              <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--border-default)", color: "var(--text-muted)" }}>
                Tablo yükleniyor...
              </div>
            }
          >
            <ScoredFundsTable enableCategoryFilter defaultMode="BEST" />
          </Suspense>
        </div>
      </main>

      <Footer />
    </div>
  );
}

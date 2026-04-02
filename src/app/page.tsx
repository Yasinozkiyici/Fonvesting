"use client";

import { Suspense } from "react";
import Header from "@/components/Header";
import MarketHeader from "@/components/bist/MarketHeader";
import StocksTable from "@/components/bist/StocksTable";
import Footer from "@/components/bist/Footer";

export default function Page() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Gradient Mesh Background */}
      <div className="gradient-mesh">
        <div className="mesh-layer-1" />
        <div className="mesh-layer-2" />
        <div className="mesh-layer-3" />
        <div className="noise" />
      </div>
      
      <Header />
      
      <main className="flex-1 mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-8">
        <MarketHeader />
        
        <div className="mt-8">
          <Suspense fallback={<div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--border-default)", color: "var(--text-muted)" }}>Tablo yukleniyor...</div>}>
            <StocksTable enableSectorFilter={false} />
          </Suspense>
        </div>
      </main>
      
      <Footer />
    </div>
  );
}

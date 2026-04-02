"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/bist/Footer";
import StocksTable from "@/components/bist/StocksTable";

type SectorRow = {
  code: string;
  name: string;
  stockCount: number;
  avgChange: number;
};

export default function SectorsPage() {
  const [sectors, setSectors] = useState<SectorRow[]>([]);

  useEffect(() => {
    fetch("/api/sectors")
      .then((r) => r.json())
      .then(setSectors)
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
            Sektorler
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Bir sektor sec ve ilgili hisseleri otomatik listele.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          <Link
            href="/sectors"
            className="rounded-full border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            Tum Sektorler
          </Link>
          {sectors.map((sector) => (
            <Link
              key={sector.code}
              href={`/sectors?sector=${sector.code}`}
              className="rounded-full border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
            >
              {sector.name} ({sector.stockCount})
            </Link>
          ))}
        </div>

        <Suspense fallback={<div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--border-default)", color: "var(--text-muted)" }}>Tablo yukleniyor...</div>}>
          <StocksTable />
        </Suspense>
      </main>

      <Footer />
    </div>
  );
}

"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/bist/Footer";
import StocksTable from "@/components/bist/StocksTable";

type IndexRow = {
  code: string;
  name: string;
  stockCount: number;
  changePercent: number;
  value: number;
};

export default function IndicesPage() {
  const [indices, setIndices] = useState<IndexRow[]>([]);

  useEffect(() => {
    fetch("/api/indices")
      .then((r) => r.json())
      .then(setIndices)
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
            Endeksler
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            BIST100 ve BIST30 endekslerini secip ilgili hisseleri goruntule.
          </p>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {indices.map((index) => (
            <Link
              key={index.code}
              href={`/indices?index=${index.code}`}
              className="rounded-xl border p-4 transition"
              style={{
                borderColor: "var(--border-default)",
                background: "var(--card-bg)",
                color: "var(--text-primary)",
              }}
            >
              <p className="text-sm font-semibold">{index.name}</p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {index.stockCount} hisse
              </p>
              <p className="mt-2 text-sm tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {index.value.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
              </p>
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

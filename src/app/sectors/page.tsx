"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/tefas/Footer";
import FundsTable from "@/components/tefas/FundsTable";

type CatRow = {
  code: string;
  name: string;
  stockCount: number;
};

export default function SectorsPage() {
  const [categories, setCategories] = useState<CatRow[]>([]);

  useEffect(() => {
    fetch("/api/sectors")
      .then((r) => r.json())
      .then((rows: CatRow[]) => setCategories(rows))
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
            Kategoriler
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Bir kategori seçin; tablo otomatik filtrelenecek. Kategoriler TEFAS tiplerine göre eşlenir.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          <Link
            href="/sectors"
            className="rounded-full border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            Tüm kategoriler
          </Link>
          {categories.map((c) => (
            <Link
              key={c.code}
              href={`/sectors?sector=${encodeURIComponent(c.code)}`}
              className="rounded-full border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
            >
              {c.name} ({c.stockCount})
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

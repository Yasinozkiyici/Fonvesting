import Link from "next/link";
import Header from "@/components/Header";
import { SitePageShell } from "@/components/SitePageShell";
import Footer from "@/components/tefas/Footer";
import FundsTable from "@/components/tefas/FundsTable";
import { LIVE_DATA_PAGE_REVALIDATE_SEC } from "@/lib/data-freshness";
import { readSearchParam, type RouteSearchParams } from "@/lib/route-search-params";
import { getCategorySummariesFromDailySnapshotSafe } from "@/lib/services/fund-daily-snapshot.service";

type CatRow = {
  code: string;
  name: string;
  stockCount: number;
};

export const revalidate = LIVE_DATA_PAGE_REVALIDATE_SEC;

export default async function SectorsPage({
  searchParams,
}: {
  searchParams?: RouteSearchParams;
}) {
  const initialCategory = readSearchParam(searchParams, "sector", "category");
  const initialQuery = readSearchParam(searchParams, "q", "query");
  const categories: CatRow[] = (await getCategorySummariesFromDailySnapshotSafe()).map((category) => ({
    code: category.code,
    name: category.name,
    stockCount: category.fundCount,
  }));

  return (
    <SitePageShell>
        <Header />

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-6 lg:px-8">
          <header className="mb-6 max-w-2xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
              Fon kategorileri
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
              Kategoriler
            </h1>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Gruplara göre dağılımı inceleyin; seçtiğiniz kategori aşağıdaki listeyi o grupla sınırlar.
            </p>
          </header>

          <div className="mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
              Gruplar
            </p>
          </div>
          <nav className="mb-8 flex flex-wrap gap-1.5 sm:gap-2" aria-label="Kategori seçimi">
            <Link
              href="/sectors"
              prefetch={false}
              className="rounded-lg border px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-[0.88] sm:px-3 sm:py-1.5"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)", background: "var(--card-bg)" }}
            >
              Tümü
            </Link>
            {categories.map((c) => (
              <Link
                key={c.code}
                href={`/sectors?sector=${encodeURIComponent(c.code)}`}
                prefetch={false}
                className="rounded-lg border px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-[0.88] sm:px-3 sm:py-1.5"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)", background: "var(--card-bg)" }}
              >
                <span>{c.name}</span>
                <span className="ml-1 tabular-nums opacity-70">{c.stockCount}</span>
              </Link>
            ))}
          </nav>

          <div>
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
              Fon listesi
            </p>
            <FundsTable
              initialCategories={categories.map((item) => ({ code: item.code, name: item.name }))}
              initialCategory={initialCategory}
              initialQuery={initialQuery}
            />
          </div>
        </main>

        <Footer />
    </SitePageShell>
  );
}

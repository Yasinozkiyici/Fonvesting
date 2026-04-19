import Link from "next/link";
import Header from "@/components/Header";
import { SitePageShell } from "@/components/SitePageShell";
import Footer from "@/components/tefas/Footer";
import FundsTable from "@/components/tefas/FundsTable";
import { LIVE_DATA_PAGE_REVALIDATE_SEC } from "@/lib/data-freshness";
import { readSearchParam, type RouteSearchParams } from "@/lib/route-search-params";
import { getFundTypeSummariesFromDailySnapshotSafe } from "@/lib/services/fund-daily-snapshot.service";
import { loadFundsTableInitialSnapshot } from "@/lib/server/funds-table-initial";

type TypeRow = {
  code: string;
  name: string;
  stockCount: number;
  value: number;
};

export const revalidate = LIVE_DATA_PAGE_REVALIDATE_SEC;

export default async function IndicesPage({
  searchParams,
}: {
  searchParams?: RouteSearchParams;
}) {
  const initialFundType = readSearchParam(searchParams, "index", "fundType");
  const initialQuery = readSearchParam(searchParams, "q", "query");
  const types: TypeRow[] = (await getFundTypeSummariesFromDailySnapshotSafe()).map((fundType) => ({
    code: String(fundType.code),
    name: fundType.name,
    stockCount: fundType.fundCount,
    value: fundType.totalPortfolioSize,
  }));

  const tableInitial = await loadFundsTableInitialSnapshot({
    initialFundType,
    initialQuery,
  });

  return (
    <SitePageShell>
        <Header />

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-6 lg:px-8">
          <header className="mb-6 max-w-2xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
              Resmi sınıflandırma
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
              Fon türleri
            </h1>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              İki resmi sınıf; karttaki tutar, o sınıftaki fonların toplam portföy büyüklüğüdür.
            </p>
          </header>

          <div className="mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
              Sınıflar
            </p>
          </div>
          <div className="mb-8 grid gap-3 sm:grid-cols-2">
            {types.map((t) => (
              <Link
                key={t.code}
                href={`/indices?index=${encodeURIComponent(t.code)}`}
                prefetch={false}
                className="rounded-xl border p-4 transition-[opacity,border-color] hover:opacity-[0.97]"
                style={{
                  borderColor: "var(--border-subtle)",
                  background: "var(--card-bg)",
                  color: "var(--text-primary)",
                  boxShadow: "var(--shadow-xs, none)",
                }}
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
                  Tür · {t.code}
                </p>
                <p className="mt-2 text-sm font-semibold leading-snug">{t.name}</p>
                <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  <span className="tabular-nums font-semibold" style={{ color: "var(--text-primary)" }}>
                    {t.stockCount.toLocaleString("tr-TR")}
                  </span>{" "}
                  fon
                  <span className="mx-1.5 opacity-35" aria-hidden>
                    ·
                  </span>
                  toplam portföy{" "}
                  <span className="tabular-nums font-semibold" style={{ color: "var(--text-primary)" }}>
                    ₺{t.value.toLocaleString("tr-TR", { maximumFractionDigits: 0 })}
                  </span>
                </p>
              </Link>
            ))}
          </div>

          <div>
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
              Fon listesi
            </p>
            <FundsTable
              initialFundTypes={types.map((item) => ({ code: Number(item.code), name: item.name }))}
              initialFundType={initialFundType}
              initialQuery={initialQuery}
              initialItems={tableInitial?.items ?? []}
              initialListTotal={tableInitial?.total}
              initialListTotalPages={tableInitial?.totalPages}
            />
          </div>
        </main>

        <Footer />
    </SitePageShell>
  );
}

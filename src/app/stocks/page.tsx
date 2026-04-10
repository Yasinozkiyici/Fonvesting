import Header from "@/components/Header";
import { SitePageShell } from "@/components/SitePageShell";
import Footer from "@/components/tefas/Footer";
import FundsTable from "@/components/tefas/FundsTable";
import { LIVE_DATA_PAGE_REVALIDATE_SEC } from "@/lib/data-freshness";
import { readSearchParam, type RouteSearchParams } from "@/lib/route-search-params";
import {
  getCategorySummariesFromDailySnapshotSafe,
  getFundTypeSummariesFromDailySnapshotSafe,
} from "@/lib/services/fund-daily-snapshot.service";

export const revalidate = LIVE_DATA_PAGE_REVALIDATE_SEC;

export default async function StocksPage({
  searchParams,
}: {
  searchParams?: RouteSearchParams;
}) {
  const initialCategory = readSearchParam(searchParams, "sector", "category");
  const initialFundType = readSearchParam(searchParams, "index", "fundType");
  const initialQuery = readSearchParam(searchParams, "q", "query");
  const [categories, fundTypes] = await Promise.all([
    getCategorySummariesFromDailySnapshotSafe(),
    getFundTypeSummariesFromDailySnapshotSafe(),
  ]);

  return (
    <SitePageShell>
        <Header />

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:px-6 sm:py-8 sm:pb-8 lg:px-8">
          <div className="mb-4 sm:mb-6">
            <h1 className="text-xl font-semibold sm:text-2xl" style={{ color: "var(--text-primary)" }}>
              Tüm fonlar
            </h1>
            <p className="mt-1 text-xs sm:text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Hafta içi işlem. Günlük % son işlem günü ile bir önceki iş gününe göre; yalnızca güncel fiyat gösterilir.
            </p>
          </div>
          <FundsTable
            initialCategories={categories.map((item) => ({ code: item.code, name: item.name }))}
            initialFundTypes={fundTypes.map((item) => ({ code: item.code, name: item.name }))}
            initialCategory={initialCategory}
            initialFundType={initialFundType}
            initialQuery={initialQuery}
          />
        </main>

        <Footer />
    </SitePageShell>
  );
}

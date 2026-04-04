import { Suspense } from "react";
import Header from "@/components/Header";
import Footer from "@/components/tefas/Footer";
import HomeMainSkeleton from "@/components/tefas/HomeMainSkeleton";
import MarketHeader from "@/components/tefas/MarketHeader";
import ScoredFundsTable from "@/components/tefas/ScoredFundsTable";
import { getCategorySummariesFromDailySnapshot, getMarketSummaryFromDailySnapshot } from "@/lib/services/fund-daily-snapshot.service";
import { getScoresPayloadCached } from "@/lib/services/fund-scores-cache.service";

export const revalidate = 86_400;

export default async function Page() {
  const [marketData, categories, initialFunds] = await Promise.all([
    getMarketSummaryFromDailySnapshot(),
    getCategorySummariesFromDailySnapshot(),
    getScoresPayloadCached("BEST", ""),
  ]);

  return (
    <div className="relative isolate flex min-h-screen flex-col">
      <div className="relative z-10 flex min-h-screen flex-col">
        <Header />

        <main className="mx-auto w-full max-w-[1320px] flex-1 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:px-6 sm:py-6 sm:pb-7 lg:px-8">
          <Suspense fallback={<HomeMainSkeleton />}>
            <MarketHeader initialData={marketData} initialCategories={categories} />
          </Suspense>

          <div id="funds-table" className="mt-4 sm:mt-5">
            <Suspense
              fallback={
                <div className="rounded-xl border p-4 text-base" style={{ borderColor: "var(--border-default)", color: "var(--text-muted)" }}>
                  Tablo yükleniyor...
                </div>
              }
            >
              <ScoredFundsTable
                enableCategoryFilter
                defaultMode="BEST"
                initialData={initialFunds}
                initialCategories={categories.map((item) => ({ code: item.code, name: item.name }))}
              />
            </Suspense>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

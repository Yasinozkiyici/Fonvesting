import Header from "@/components/Header";
import { SitePageShell } from "@/components/SitePageShell";
import Footer from "@/components/tefas/Footer";
import MarketHeader from "@/components/tefas/MarketHeader";
import { HomePageClient } from "@/components/home/HomePageClient";
import { LIVE_DATA_PAGE_REVALIDATE_SEC } from "@/lib/data-freshness";
import { parseFundThemeParam } from "@/lib/fund-themes";
import { parseFundIntentParam, resolveFundIntentState } from "@/lib/fund-intents";
import { readSearchParam, type RouteSearchParams } from "@/lib/route-search-params";
import {
  getCategorySummariesFromDailySnapshotSafe,
  getMarketSummaryFromDailySnapshotSafe,
} from "@/lib/services/fund-daily-snapshot.service";
import { getScoresPayloadServerCachedSafe } from "@/lib/services/fund-scores-cache.service";

export const revalidate = LIVE_DATA_PAGE_REVALIDATE_SEC;
export const dynamic = "force-dynamic";
const INITIAL_VISIBLE_FUNDS = 50;

export default async function Page({
  searchParams,
}: {
  searchParams?: RouteSearchParams;
}) {
  const requestedMode = parseRankingModeParam(readSearchParam(searchParams, "mode"));
  const requestedCategory = readSearchParam(searchParams, "sector", "category");
  const initialQuery = readSearchParam(searchParams, "q", "query");
  const initialIntent = parseFundIntentParam(readSearchParam(searchParams, "intent"));
  const initialTheme = parseFundThemeParam(readSearchParam(searchParams, "theme"));
  const [marketData, categories] = await Promise.all([
    getMarketSummaryFromDailySnapshotSafe(),
    getCategorySummariesFromDailySnapshotSafe(),
  ]);
  const intentResolved = resolveFundIntentState(
    initialIntent,
    categories.map((item) => ({ code: item.code, name: item.name })),
    { mode: requestedMode, category: requestedCategory }
  );
  const initialMode = intentResolved.mode;
  const initialCategory = intentResolved.category;
  const initialScores = await getScoresPayloadServerCachedSafe(initialMode, "", "");
  const initialScoresPreview =
    initialScores && initialScores.funds.length > INITIAL_VISIBLE_FUNDS
      ? { ...initialScores, funds: initialScores.funds.slice(0, INITIAL_VISIBLE_FUNDS) }
      : initialScores;

  return (
    <SitePageShell>
        <Header />

        <main className="mx-auto w-full max-w-[1320px] flex-1 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:px-6 sm:py-5 sm:pb-7 lg:px-8">
          <MarketHeader
            initialData={marketData}
          />

          <HomePageClient
            initialScoresPreview={initialScoresPreview}
            initialScoresPartial={Boolean(initialScores && initialScores.funds.length > INITIAL_VISIBLE_FUNDS)}
            categories={categories.map((item) => ({ code: item.code, name: item.name }))}
            initialMode={initialMode}
            initialCategory={initialCategory}
            initialQuery={initialQuery}
            initialIntent={initialIntent}
            initialTheme={initialTheme}
          />
        </main>

        <Footer />
    </SitePageShell>
  );
}

function parseRankingModeParam(raw: string): "BEST" | "LOW_RISK" | "HIGH_RETURN" | "STABLE" {
  if (raw === "LOW_RISK" || raw === "HIGH_RETURN" || raw === "STABLE") return raw;
  return "BEST";
}

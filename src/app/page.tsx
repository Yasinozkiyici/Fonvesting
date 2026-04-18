import Header from "@/components/Header";
import { SitePageShell } from "@/components/SitePageShell";
import Footer from "@/components/tefas/Footer";
import MarketHeader from "@/components/tefas/MarketHeader";
import { HomePageClient } from "@/components/home/HomePageClient";
import { LIVE_DATA_PAGE_REVALIDATE_SEC } from "@/lib/data-freshness";
import { parseFundThemeParam } from "@/lib/fund-themes";
import { parseFundIntentParam, resolveFundIntentState } from "@/lib/fund-intents";
import { readSearchParam, type RouteSearchParams } from "@/lib/route-search-params";
import { deriveMarketTone } from "@/lib/market-tone";
import {
  getCategorySummariesFromDailySnapshotSafe,
  getMarketSummaryFromDailySnapshotSafe,
  getScoresPayloadFromDailySnapshot,
  type MarketSnapshotSummaryPayload,
} from "@/lib/services/fund-daily-snapshot.service";
import { listFundDetailCoreServingRows } from "@/lib/services/fund-detail-core-serving.service";
import type { ScoredResponse } from "@/types/scored-funds";
import {
  buildHomepageTotalsEvidence,
  formatHomepageTotalsEvidenceLog,
  resolveHomepageTrueUniverseTotal,
} from "@/lib/homepage-fund-counts";
import type { HomepageTotalsSemanticContract } from "@/lib/data-flow/contracts";
import {
  deriveHomepageDiscoverySurfaceState,
  logHomepageDataFlowEvidence,
  prepareHomepageCategoriesForClient,
  prepareHomepageScoresPreviewAtBoundary,
} from "@/lib/data-flow";
import { readScoresUniverseTotal } from "@/lib/scores-response-counts";
import { createScoresPayload } from "@/lib/services/fund-scores-semantics";

export const revalidate = LIVE_DATA_PAGE_REVALIDATE_SEC;
export const dynamic = "force-dynamic";
const HOME_SSR_SCORES_TIMEOUT_MS = parseEnvMs("HOME_SSR_SCORES_TIMEOUT_MS", 1_600, 1_200, 10_000);
const HOME_SSR_SCORES_LIMIT = parseEnvMs("HOME_SSR_SCORES_LIMIT", 180, 60, 600);
const HOME_SSR_CORE_ROWS_TIMEOUT_MS = parseEnvMs("HOME_SSR_CORE_ROWS_TIMEOUT_MS", 700, 250, 5_000);
const HOME_SSR_CORE_ROWS_LIMIT = parseEnvMs("HOME_SSR_CORE_ROWS_LIMIT", 180, 30, 500);
const HOME_SSR_CATEGORY_TIMEOUT_MS = parseEnvMs("HOME_SSR_CATEGORY_TIMEOUT_MS", 1_200, 250, 8_000);
const HOME_SSR_MARKET_TIMEOUT_MS = parseEnvMs("HOME_SSR_MARKET_TIMEOUT_MS", 1_500, 250, 8_000);
// Launch-readiness için ana sayfada gerçek evren/özet metriklerini SSR'da zorunlu yükle.
const HOME_SSR_DB_SCORES_ENABLED = true;
const HOME_SSR_MARKET_ENABLED = true;

function parseEnvMs(name: string, fallback: number, min: number, max: number): number {
  const rawValue = process.env[name];
  if (typeof rawValue !== "string" || rawValue.trim() === "") return fallback;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

async function withSoftTimeout<T>(task: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, timeoutMs);

    task
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

async function withSoftTimeoutMeta<T>(
  task: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<{ value: T; timedOut: boolean; durationMs: number }> {
  const startedAt = Date.now();
  const value = await new Promise<{ value: T; timedOut: boolean }>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ value: fallback, timedOut: true });
    }, timeoutMs);

    task
      .then((next) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ value: next, timedOut: false });
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ value: fallback, timedOut: false });
      });
  });

  return { ...value, durationMs: Date.now() - startedAt };
}

type HomeServingRows = Awaited<ReturnType<typeof listFundDetailCoreServingRows>>;

function scoresPreviewFromServingRows(
  mode: "BEST" | "LOW_RISK" | "HIGH_RETURN" | "STABLE",
  servingRows: HomeServingRows
): ScoredResponse | null {
  if (servingRows.rows.length === 0) return null;
  return createScoresPayload({
    mode,
    universeTotal: 0,
    matchedTotal: servingRows.rows.length,
    funds: servingRows.rows.map((row) => ({
      fundId: row.fundId,
      code: row.code,
      name: row.name,
      shortName: row.shortName,
      logoUrl: row.logoUrl,
      lastPrice: row.lastPrice,
      dailyReturn: row.dailyReturn,
      portfolioSize: row.portfolioSize,
      investorCount: row.investorCount,
      category:
        row.categoryCode && row.categoryName
          ? { code: row.categoryCode, name: row.categoryName }
          : null,
      fundType:
        row.fundTypeCode != null && row.fundTypeName
          ? { code: row.fundTypeCode, name: row.fundTypeName }
          : null,
      finalScore: null,
    })),
  });
}

function categoriesFromServingRows(servingRows: HomeServingRows): Array<{ code: string; name: string }> {
  const byCode = new Map<string, string>();
  for (const row of servingRows.rows) {
    if (!row.categoryCode || !row.categoryName) continue;
    byCode.set(row.categoryCode, row.categoryName);
  }
  return [...byCode.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

function deriveMarketSummaryFromServingRows(servingRows: HomeServingRows): MarketSnapshotSummaryPayload | null {
  if (servingRows.rows.length === 0) return null;
  const totalPortfolioSize = servingRows.rows.reduce((sum, row) => sum + (Number.isFinite(row.portfolioSize) ? row.portfolioSize : 0), 0);
  const totalInvestorCount = servingRows.rows.reduce((sum, row) => sum + (Number.isFinite(row.investorCount) ? row.investorCount : 0), 0);
  const returns = servingRows.rows
    .map((row) => row.dailyReturn)
    .filter((value) => Number.isFinite(value));
  const avgDailyReturn = returns.length > 0 ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const advancers = returns.filter((value) => value > 0).length;
  const decliners = returns.filter((value) => value < 0).length;
  const unchanged = Math.max(0, servingRows.rows.length - advancers - decliners);
  return {
    summary: {
      avgDailyReturn,
      totalFundCount: servingRows.rows.length,
    },
    fundCount: servingRows.rows.length,
    snapshotFundCountIsCanonicalUniverse: false,
    totalPortfolioSize,
    totalInvestorCount,
    advancers,
    decliners,
    unchanged,
    lastSyncedAt: null,
    snapshotDate: null,
    usdTry: null,
    eurTry: null,
    topGainers: [],
    topLosers: [],
    formatted: {
      totalPortfolioSize: `₺${Math.round(totalPortfolioSize).toLocaleString("tr-TR")}`,
      totalInvestorCount: Math.round(totalInvestorCount).toLocaleString("tr-TR"),
    },
  };
}

function resolveHomepageMarketData(
  marketDataRaw: MarketSnapshotSummaryPayload | null,
  servingRows: HomeServingRows
): MarketSnapshotSummaryPayload | null {
  // Üst özet kaynağı için temel kural:
  // - Gerçek market summary varsa (fund/portfolio dolu), direction + FX dahil onu koru.
  // - Yalnızca market summary yoksa serving fallback'e düş.
  // Böylece preview satır limiti (örn. 180) üst metrikleri yanlış daraltmaz.
  if (
    marketDataRaw &&
    marketDataRaw.fundCount > 0 &&
    marketDataRaw.totalPortfolioSize > 0
  ) {
    return marketDataRaw;
  }
  return deriveMarketSummaryFromServingRows(servingRows);
}

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
  try {
  const servingRowsTask = withSoftTimeout(
    listFundDetailCoreServingRows(HOME_SSR_CORE_ROWS_LIMIT),
    HOME_SSR_CORE_ROWS_TIMEOUT_MS,
    { rows: [], source: "none" as const, missReason: "cache_empty" as const }
  );
  const marketSummaryTask = HOME_SSR_MARKET_ENABLED
    ? withSoftTimeout(getMarketSummaryFromDailySnapshotSafe(), HOME_SSR_MARKET_TIMEOUT_MS, null)
    : Promise.resolve(null as MarketSnapshotSummaryPayload | null);
  const servingRows = await servingRowsTask;
  const servingCategories = categoriesFromServingRows(servingRows);
  const [marketSummaryRaw, categories] = await Promise.all([
    marketSummaryTask,
    servingCategories.length > 0
      ? Promise.resolve(servingCategories)
      : withSoftTimeout(getCategorySummariesFromDailySnapshotSafe(), HOME_SSR_CATEGORY_TIMEOUT_MS, []),
  ]);
  const { categories: categoriesForClient, rejectedRows: homepageCategoryRejectedRows } =
    prepareHomepageCategoriesForClient(categories);
  const marketData = resolveHomepageMarketData(marketSummaryRaw, servingRows);
  const intentResolved = resolveFundIntentState(
    initialIntent,
    categoriesForClient,
    { mode: requestedMode, category: requestedCategory }
  );
  const initialMode = intentResolved.mode;
  const initialCategory = intentResolved.category;
  const scorePreloadPhase = (() => {
    const g = globalThis as typeof globalThis & { __homeSsrScoresPreloadSeen?: boolean };
    const cold = !g.__homeSsrScoresPreloadSeen;
    g.__homeSsrScoresPreloadSeen = true;
    return cold ? "cold_process" : "warm_process";
  })();
  const initialScoresMeta = HOME_SSR_DB_SCORES_ENABLED
    ? await withSoftTimeoutMeta(
        getScoresPayloadFromDailySnapshot(initialMode, "", {
          limit: HOME_SSR_SCORES_LIMIT,
          includeTotal: true,
        }),
        HOME_SSR_SCORES_TIMEOUT_MS,
        null
      )
    : { value: null as ScoredResponse | null, timedOut: false, durationMs: 0 };
  const initialScores = initialScoresMeta.value;
  let initialRowsSource: "scores" | "serving_core" | "none" = "scores";
  let initialScoresPreview: ScoredResponse | null = initialScores;
  if (!initialScoresPreview || initialScoresPreview.funds.length === 0) {
    const servingPreview = scoresPreviewFromServingRows(initialMode, servingRows);
    if (servingPreview) {
      initialScoresPreview = servingPreview;
      initialRowsSource = "serving_core";
    } else {
      initialRowsSource = "none";
    }
  }
  const homepageFundsCountBeforeBoundary = initialScoresPreview?.funds.length ?? null;
  const initialScoresPreviewForClient =
    prepareHomepageScoresPreviewAtBoundary(initialScoresPreview) ?? initialScoresPreview;
  const discoverySurface = deriveHomepageDiscoverySurfaceState({
    categoryCount: categoriesForClient.length,
    scoresPreview: initialScoresPreviewForClient,
    categoryRejectedRows: homepageCategoryRejectedRows,
    preNormalizationFundCount: homepageFundsCountBeforeBoundary,
  });
  console.info(
    `[home-ssr-scores] mode=${initialMode} timeout_ms=${HOME_SSR_SCORES_TIMEOUT_MS} duration_ms=${initialScoresMeta.durationMs} ` +
      `timed_out=${initialScoresMeta.timedOut ? 1 : 0} rows=${initialScores?.funds.length ?? 0} universe=${initialScores ? readScoresUniverseTotal(initialScores) : 0} phase=${scorePreloadPhase}`
  );
  console.info(
    `[home-ssr-rows] mode=${initialMode} homepage_rows_source=${initialRowsSource} homepage_rows_count=${initialScoresPreviewForClient?.funds.length ?? 0}`
  );
  const marketSnapshotCanonical = marketData?.snapshotFundCountIsCanonicalUniverse !== false;
  const marketSnapshotFundCount =
    marketSnapshotCanonical && marketData?.fundCount != null && marketData.fundCount > 0 ? marketData.fundCount : null;
  const universeResolution = resolveHomepageTrueUniverseTotal({
    initialScores,
    initialRowsSource,
    scoresTimedOut: initialScoresMeta.timedOut,
    scoresPreviewLimit: HOME_SSR_SCORES_LIMIT,
    marketSnapshotFundCount,
    marketSnapshotCanonical,
  });
  const exploreUniverseTotal = universeResolution.kind === "known" ? universeResolution.value : null;
  const totalsEvidence = buildHomepageTotalsEvidence({
    resolution: universeResolution,
    loadedPreviewRowCount: initialScoresPreviewForClient?.funds.length ?? 0,
    scoresRowSource: initialRowsSource,
    scoresTimedOut: initialScoresMeta.timedOut,
    rawScoresTotal: initialScores ? readScoresUniverseTotal(initialScores) : null,
    marketSnapshotFundCount: marketData?.fundCount ?? null,
    marketSnapshotCanonical,
  });
  const totalsSemantic: HomepageTotalsSemanticContract = {
    ...totalsEvidence,
    previewLimit: HOME_SSR_SCORES_LIMIT,
  };
  console.info(formatHomepageTotalsEvidenceLog(totalsEvidence));
  logHomepageDataFlowEvidence({
    surface: "homepage_ssr",
    discovery_surface: discoverySurface.kind,
    category_rejected_rows: homepageCategoryRejectedRows,
    scores_row_source: initialRowsSource,
    preview_limit: totalsSemantic.previewLimit,
    loaded_preview_rows: totalsSemantic.loadedPreviewRowCount,
    true_universe_kind: totalsSemantic.trueUniverse.kind,
    true_universe_value: totalsSemantic.trueUniverse.kind === "known" ? totalsSemantic.trueUniverse.value : null,
  });
  const initialScoresPreviewRows = initialScoresPreviewForClient?.funds.length ?? 0;
  const knownUniverseFloor =
    universeResolution.kind === "known" ? universeResolution.value : initialScoresPreviewRows;
  // Homepage defaultta SSR preview satırlarını "tam skor payload" sanıp kilitlenmeyelim:
  // tablo/search ilk yükten sonra tam scope'u client tarafında bir kez yenilemeli.
  const initialScoresPartial =
    initialScoresMeta.timedOut ||
    !initialScores ||
    initialRowsSource !== "scores" ||
    universeResolution.kind === "unknown" ||
    initialScoresPreviewRows < knownUniverseFloor;

  const marketDayTone = (() => {
    if (!marketData) return null;
    const avg = marketData.summary?.avgDailyReturn;
    if (!Number.isFinite(avg)) return null;
    return deriveMarketTone(marketData.advancers, marketData.decliners, avg);
  })();

  return (
    <SitePageShell>
        <Header />

        <main className="mx-auto w-full min-w-0 max-w-[1320px] flex-1 overflow-x-clip overscroll-x-none px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:px-6 sm:py-5 sm:pb-7 lg:px-8">
          <MarketHeader initialData={marketData} exploreUniverseTotal={exploreUniverseTotal} />

          <HomePageClient
            initialScoresPreview={initialScoresPreviewForClient}
            initialScoresPartial={initialScoresPartial}
            canonicalUniverseTotal={exploreUniverseTotal}
            categories={categoriesForClient}
            initialMode={initialMode}
            initialCategory={initialCategory}
            initialQuery={initialQuery}
            initialIntent={initialIntent}
            initialTheme={initialTheme}
            marketDayTone={marketDayTone}
          />
        </main>

        <Footer />
    </SitePageShell>
  );
  } catch (error) {
    console.error("[homepage-route-fallback] render failed, serving safe fallback", error);
    return (
      <SitePageShell>
          <Header />

          <main className="mx-auto w-full min-w-0 max-w-[1320px] flex-1 overflow-x-clip overscroll-x-none px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:px-6 sm:py-5 sm:pb-7 lg:px-8">
            <MarketHeader initialData={null} exploreUniverseTotal={null} />

            <HomePageClient
              initialScoresPreview={null}
              initialScoresPartial={true}
              canonicalUniverseTotal={null}
              categories={[]}
              initialMode={requestedMode}
              initialCategory={requestedCategory}
              initialQuery={initialQuery}
              initialIntent={initialIntent}
              initialTheme={initialTheme}
              marketDayTone={null}
            />
          </main>

          <Footer />
      </SitePageShell>
    );
  }
}

function parseRankingModeParam(raw: string): "BEST" | "LOW_RISK" | "HIGH_RETURN" | "STABLE" {
  if (raw === "LOW_RISK" || raw === "HIGH_RETURN" || raw === "STABLE") return raw;
  return "BEST";
}

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import { latestExpectedBusinessSessionDate } from "@/lib/daily-sync-policy";
import {
  calculateAllMetrics,
  determineRiskLevel,
  getBenchmarkForCategory,
  getBenchmarkName,
  type FundMetrics,
  type PricePoint,
  type RiskLevel,
} from "@/lib/scoring";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import { fundTypeDisplayLabel } from "@/lib/fund-type-display";
import {
  buildFundAlternatives,
  FUND_ALTERNATIVES_CANDIDATE_POOL,
  type FundAlternativeCandidate,
} from "@/lib/fund-detail-alternatives";
import {
  buildFundKiyasBlock,
  type FundKiyasViewPayload,
} from "@/lib/services/fund-detail-kiyas.service";
import {
  getFundDetailCoreServingCached,
  getFundDetailCoreServingSnapshotDateHint,
  listFundDetailCoreServingAlternatives,
  type FundDetailCoreServingPayload,
  type FundDetailCoreTrendPoint,
} from "@/lib/services/fund-detail-core-serving.service";
import {
  deriveFundDetailSectionStates,
  type FundDetailSectionState,
  type FundDetailSectionStates,
} from "@/lib/fund-detail-section-status";
import { classifyDatabaseError } from "@/lib/database-error-classifier";
import { detailEnrichmentDbFailureLogLevel } from "@/lib/operational-hardening";
import { fetchSupabaseRestJson, hasSupabaseRestConfig } from "@/lib/supabase-rest";
import { shouldDropServingRowForUniverseLag } from "@/lib/services/fund-detail-serving-lag";
import { getFundsPage } from "@/lib/services/fund-list.service";

const DAY_MS = 86400000;
const DETAIL_HISTORY_LOOKBACK_DAYS = parseEnvMs("FUND_DETAIL_HISTORY_LOOKBACK_DAYS", 1095, 120, 1095);
const ROLLING_TRADING_DAYS = 21;
const DETAIL_PRICE_SERIES_MAX_POINTS = 420;
const DETAIL_TREND_SERIES_MAX_POINTS = 180;
const DETAIL_HISTORY_FETCH_LIMIT = parseEnvMs("FUND_DETAIL_HISTORY_FETCH_LIMIT", 1200, 120, 1200);
const DETAIL_CORE_SERIES_LIMIT = parseEnvMs("FUND_DETAIL_CORE_SERIES_LIMIT", 180, 30, 540);
const ENABLE_EAGER_DETAIL_SECONDARY = process.env.FUND_DETAIL_EAGER_SECONDARY === "1";
const DETAIL_RESCUE_MODE = process.env.FUND_DETAIL_RESCUE_MODE === "1";
const DETAIL_PHASE1_MINIMAL = process.env.FUND_DETAIL_PHASE1_MINIMAL === "1";
const DETAIL_DEFER_OPTIONAL_SECTIONS = process.env.FUND_DETAIL_DEFER_OPTIONAL_SECTIONS !== "0";
const DETAIL_FRESH_TTL_MS = parseEnvMs("FUND_DETAIL_FRESH_TTL_MS", 120_000, 5_000, 30 * 60_000);
const DETAIL_STALE_TTL_MS = parseEnvMs("FUND_DETAIL_STALE_TTL_MS", 30 * 60_000, 30_000, 24 * 60 * 60_000);
const DETAIL_DEGRADED_FRESH_TTL_MS = parseEnvMs("FUND_DETAIL_DEGRADED_FRESH_TTL_MS", 8_000, 1_000, 180_000);
const DETAIL_DEGRADED_STALE_TTL_MS = parseEnvMs("FUND_DETAIL_DEGRADED_STALE_TTL_MS", 90_000, 5_000, 10 * 60_000);
const DETAIL_EMERGENCY_FRESH_TTL_MS = parseEnvMs("FUND_DETAIL_EMERGENCY_FRESH_TTL_MS", 2_500, 500, 60_000);
const DETAIL_EMERGENCY_STALE_TTL_MS = parseEnvMs("FUND_DETAIL_EMERGENCY_STALE_TTL_MS", 15_000, 1_000, 120_000);
const DETAIL_FAILURE_COOLDOWN_MS = parseEnvMs("FUND_DETAIL_FAILURE_COOLDOWN_MS", 45_000, 5_000, 10 * 60_000);
const DETAIL_TOTAL_BUDGET_MS = parseEnvMs("FUND_DETAIL_TOTAL_BUDGET_MS", 5_000, 1_000, 15_000);
const DETAIL_LATEST_SNAPSHOT_TIMEOUT_MS = parseEnvMs("FUND_DETAIL_LATEST_SNAPSHOT_TIMEOUT_MS", 1_800, 600, 4_000);
const DETAIL_CORE_SNAPSHOT_TIMEOUT_MS = parseEnvMs("FUND_DETAIL_CORE_SNAPSHOT_TIMEOUT_MS", 4_500, 800, 7_000);
const DETAIL_MINIMAL_FUND_TIMEOUT_MS = parseEnvMs("FUND_DETAIL_MINIMAL_FUND_TIMEOUT_MS", 1_600, 600, 12_000);
const DETAIL_MINIMAL_FUND_REST_TIMEOUT_MS = parseEnvMs(
  "FUND_DETAIL_MINIMAL_FUND_REST_TIMEOUT_MS",
  1_800,
  700,
  8_000
);
const DETAIL_MINIMAL_FUND_REST_FALLBACK_ENABLED = process.env.FUND_DETAIL_MINIMAL_FUND_REST_FALLBACK !== "0";
const DETAIL_CORE_SNAPSHOT_FALLBACK_ENABLED = process.env.FUND_DETAIL_CORE_SNAPSHOT_FALLBACK !== "0";
const DETAIL_CORE_SNAPSHOT_FALLBACK_TIMEOUT_MS = parseEnvMs(
  "FUND_DETAIL_CORE_SNAPSHOT_FALLBACK_TIMEOUT_MS",
  2_600,
  400,
  4_000
);
const DETAIL_ALTERNATIVES_FUNDS_LIST_FALLBACK_TIMEOUT_MS = parseEnvMs(
  "FUND_DETAIL_ALTERNATIVES_FUNDS_LIST_FALLBACK_TIMEOUT_MS",
  1_100,
  400,
  3_000
);
const DETAIL_CORE_SNAPSHOT_FALLBACK_LIMIT = parseEnvMs("FUND_DETAIL_CORE_SNAPSHOT_FALLBACK_LIMIT", 420, 32, 720);
const DETAIL_PHASE1_HISTORY_UPGRADE_ENABLED = process.env.FUND_DETAIL_PHASE1_HISTORY_UPGRADE === "1";
const DETAIL_PHASE1_HISTORY_UPGRADE_TIMEOUT_MS = parseEnvMs(
  "FUND_DETAIL_PHASE1_HISTORY_UPGRADE_TIMEOUT_MS",
  1_350,
  350,
  3_500
);
const DETAIL_PHASE1_HISTORY_UPGRADE_LIMIT = parseEnvMs(
  "FUND_DETAIL_PHASE1_HISTORY_UPGRADE_LIMIT",
  900,
  120,
  1400
);
const DETAIL_PHASE1_HISTORY_UPGRADE_MIN_POINTS = parseEnvMs(
  "FUND_DETAIL_PHASE1_HISTORY_UPGRADE_MIN_POINTS",
  40,
  8,
  220
);
const DETAIL_PHASE1_SERVING_UPGRADE_ENABLED = process.env.FUND_DETAIL_PHASE1_SERVING_UPGRADE === "1";
const DETAIL_CORE_SERVING_READ_TIMEOUT_MS = parseEnvMs(
  "FUND_DETAIL_CORE_SERVING_READ_TIMEOUT_MS",
  1_200,
  300,
  4_000
);
const DETAIL_CORE_SERVING_FILE_ONLY = process.env.FUND_DETAIL_CORE_SERVING_FILE_ONLY === "1";
const DETAIL_CORE_SERVING_STALE_MS = parseEnvMs(
  "FUND_DETAIL_CORE_SERVING_STALE_MS",
  48 * 60 * 60_000,
  10 * 60_000,
  14 * 24 * 60 * 60_000
);
const DETAIL_CORE_SERVING_MAX_SNAPSHOT_LAG_DAYS = parseEnvMs(
  "FUND_DETAIL_CORE_SERVING_MAX_SNAPSHOT_LAG_DAYS",
  2,
  1,
  30
);
const DETAIL_CORE_SERVING_ROW_LAG_VS_UNIVERSE_MAX_DAYS = parseEnvMs(
  "FUND_DETAIL_CORE_SERVING_ROW_LAG_VS_UNIVERSE_MAX_DAYS",
  7,
  1,
  45
);

const DETAIL_ADAPTIVE_RESCUE_THRESHOLD_MS = parseEnvMs(
  "FUND_DETAIL_ADAPTIVE_RESCUE_THRESHOLD_MS",
  Math.max(1_600, Math.round(DETAIL_TOTAL_BUDGET_MS * 0.6)),
  500,
  20_000
);
const DETAIL_MIN_HISTORY_METRICS_POINTS = parseEnvMs(
  "FUND_DETAIL_MIN_HISTORY_METRICS_POINTS",
  40,
  8,
  360
);
const DETAIL_RETURN_WINDOW_TOLERANCE_DAYS = parseEnvMs(
  "FUND_DETAIL_RETURN_WINDOW_TOLERANCE_DAYS",
  14,
  2,
  45
);
const DETAIL_OPTIONAL_KIYAS_TIMEOUT_MS = parseEnvMs(
  "FUND_DETAIL_OPTIONAL_KIYAS_TIMEOUT_MS",
  2_200,
  600,
  6_000
);
const DETAIL_COMPARISON_CORE_TIMEOUT_MS = parseEnvMs(
  "FUND_DETAIL_COMPARISON_CORE_TIMEOUT_MS",
  DETAIL_OPTIONAL_KIYAS_TIMEOUT_MS,
  600,
  6_000
);
const DETAIL_PHASE2_OPTIONAL_BUDGET_MS = parseEnvMs(
  "FUND_DETAIL_PHASE2_OPTIONAL_BUDGET_MS",
  900,
  200,
  6_000
);
const DETAIL_PHASE2_OPTIONAL_MIN_STEP_BUDGET_MS = parseEnvMs(
  "FUND_DETAIL_PHASE2_OPTIONAL_MIN_STEP_BUDGET_MS",
  140,
  50,
  1_500
);
const DETAIL_PHASE2_TARGET_MS = parseEnvMs(
  "FUND_DETAIL_PHASE2_TARGET_MS",
  Math.max(2_600, Math.round(DETAIL_TOTAL_BUDGET_MS * 0.72)),
  1_500,
  DETAIL_TOTAL_BUDGET_MS
);
const DETAIL_PHASE2_MAX_CONCURRENCY = parseEnvMs("FUND_DETAIL_PHASE2_MAX_CONCURRENCY", 1, 1, 8);
const DETAIL_LATEST_SNAPSHOT_CACHE_TTL_MS = parseEnvMs(
  "FUND_DETAIL_LATEST_SNAPSHOT_CACHE_TTL_MS",
  8_000,
  1_000,
  120_000
);
const DETAIL_HISTORY_CACHE_TTL_MS = parseEnvMs("FUND_DETAIL_HISTORY_CACHE_TTL_MS", 15_000, 1_000, 180_000);
const DETAIL_HISTORY_STALE_ON_FAILURE_TTL_MS = parseEnvMs(
  "FUND_DETAIL_HISTORY_STALE_ON_FAILURE_TTL_MS",
  10 * 60_000,
  5_000,
  60 * 60_000
);
const DETAIL_PRICE_HISTORY_DB_STATEMENT_TIMEOUT_MS = parseEnvMs(
  "FUND_DETAIL_PRICE_HISTORY_DB_STATEMENT_TIMEOUT_MS",
  12_000,
  2_500,
  60_000
);
const DETAIL_PRICE_HISTORY_DB_MAX_WAIT_MS = parseEnvMs(
  "FUND_DETAIL_PRICE_HISTORY_DB_MAX_WAIT_MS",
  1_200,
  250,
  10_000
);
const DETAIL_PRICE_HISTORY_FAILURE_COOLDOWN_MS = parseEnvMs(
  "FUND_DETAIL_PRICE_HISTORY_FAILURE_COOLDOWN_MS",
  75_000,
  5_000,
  10 * 60_000
);
const DETAIL_HOT_READ_CACHE_MAX_KEYS = parseEnvMs("FUND_DETAIL_HOT_READ_CACHE_MAX_KEYS", 128, 16, 2_048);
const DETAIL_PRICE_HISTORY_SNAPSHOT_FASTPATH = process.env.FUND_DETAIL_PRICE_HISTORY_SNAPSHOT_FASTPATH !== "0";
const DETAIL_PRICE_HISTORY_LIVE_FALLBACK_ENABLED = process.env.FUND_DETAIL_PRICE_HISTORY_LIVE_FALLBACK === "1";
const DETAIL_PRICE_HISTORY_REST_FALLBACK_ENABLED = process.env.FUND_DETAIL_PRICE_HISTORY_REST_FALLBACK !== "0";
const DETAIL_PRICE_HISTORY_REST_TIMEOUT_MS = parseEnvMs(
  "FUND_DETAIL_PRICE_HISTORY_REST_TIMEOUT_MS",
  1_600,
  600,
  6_000
);
const DETAIL_PHASE2_REUSE_SERVING_LATEST = process.env.FUND_DETAIL_PHASE2_REUSE_SERVING_LATEST !== "0";
const DETAIL_PHASE2_SERVING_SEED_TIMEOUT_MS = parseEnvMs(
  "FUND_DETAIL_PHASE2_SERVING_SEED_TIMEOUT_MS",
  400,
  120,
  1_500
);
const DETAIL_PHASE2_REQUEST_SEED_TTL_MS = parseEnvMs(
  "FUND_DETAIL_PHASE2_REQUEST_SEED_TTL_MS",
  12_000,
  2_000,
  60_000
);
const DETAIL_HISTORY_SERVING_PRIMARY = process.env.FUND_DETAIL_HISTORY_SERVING_PRIMARY !== "0";
const DETAIL_HISTORY_LIVE_QUERY_ENABLED = process.env.FUND_DETAIL_HISTORY_LIVE_QUERY === "1";
const DETAIL_HISTORY_SERVING_MIN_COVERAGE_DAYS = parseEnvMs(
  "FUND_DETAIL_HISTORY_SERVING_MIN_COVERAGE_DAYS",
  900,
  90,
  1200
);
const DETAIL_HISTORY_SERVING_MIN_POINTS = parseEnvMs(
  "FUND_DETAIL_HISTORY_SERVING_MIN_POINTS",
  64,
  8,
  720
);
const DETAIL_PRICE_HISTORY_SNAPSHOT_DENSE_MIN_POINTS = parseEnvMs(
  "FUND_DETAIL_PRICE_HISTORY_SNAPSHOT_DENSE_MIN_POINTS",
  DETAIL_HISTORY_SERVING_MIN_POINTS,
  8,
  720
);
const DETAIL_PRICE_HISTORY_SNAPSHOT_DENSE_MIN_COVERAGE_DAYS = parseEnvMs(
  "FUND_DETAIL_PRICE_HISTORY_SNAPSHOT_DENSE_MIN_COVERAGE_DAYS",
  DETAIL_HISTORY_SERVING_MIN_COVERAGE_DAYS,
  30,
  1200
);
const DETAIL_PRICE_HISTORY_DISTINCT_FALLBACK = process.env.FUND_DETAIL_PRICE_HISTORY_DISTINCT_FALLBACK === "1";
const DETAIL_HISTORY_SERVING_ACCEPT_SNAPSHOT_COMPACT =
  process.env.FUND_DETAIL_HISTORY_SERVING_ACCEPT_SNAPSHOT_COMPACT === "1";
const DETAIL_HISTORY_SERVING_SYNTHETIC_EXTEND = process.env.FUND_DETAIL_HISTORY_SERVING_SYNTHETIC_EXTEND !== "0";
const DETAIL_CHART_FULL_MIN_POINTS = parseEnvMs("FUND_DETAIL_CHART_FULL_MIN_POINTS", 96, 16, 720);
const DETAIL_CHART_FULL_MIN_COVERAGE_DAYS = parseEnvMs("FUND_DETAIL_CHART_FULL_MIN_COVERAGE_DAYS", 540, 90, 1460);
const DETAIL_CHART_PARTIAL_MIN_POINTS = parseEnvMs("FUND_DETAIL_CHART_PARTIAL_MIN_POINTS", 12, 2, 360);
const DETAIL_CHART_GAP_THRESHOLD_DAYS = parseEnvMs("FUND_DETAIL_CHART_GAP_THRESHOLD_DAYS", 7, 2, 45);
const DETAIL_CHART_FULL_MAX_GAP_RATIO_PCT = parseEnvMs("FUND_DETAIL_CHART_FULL_MAX_GAP_RATIO_PCT", 35, 5, 90);
const DETAIL_CHART_FULL_MAX_FRESHNESS_DAYS = parseEnvMs("FUND_DETAIL_CHART_FULL_MAX_FRESHNESS_DAYS", 21, 1, 90);
const DETAIL_TREND_FULL_MIN_POINTS = parseEnvMs("FUND_DETAIL_TREND_FULL_MIN_POINTS", 20, 2, 360);
const DETAIL_TREND_FULL_MIN_COVERAGE_DAYS = parseEnvMs("FUND_DETAIL_TREND_FULL_MIN_COVERAGE_DAYS", 180, 30, 1460);
const DETAIL_TREND_OUTLIER_MAX_JUMP_RATIO = parseEnvMs("FUND_DETAIL_TREND_OUTLIER_MAX_JUMP_RATIO", 80, 8, 1000);
const DETAIL_PHASE2_HISTORY_PRIME_ENABLED = process.env.FUND_DETAIL_PHASE2_HISTORY_PRIME === "1";
const DETAIL_PHASE2_HISTORY_PRIME_WAIT_MS = parseEnvMs(
  "FUND_DETAIL_PHASE2_HISTORY_PRIME_WAIT_MS",
  220,
  0,
  1_200
);
const DETAIL_DEBUG_HISTORY_BOUNDS_DB = process.env.FUND_DETAIL_DEBUG_HISTORY_BOUNDS_DB === "1";
const DETAIL_DEBUG_CODES = new Set(
  (process.env.FUND_DETAIL_DEBUG_CODES ??
    (process.env.NODE_ENV === "production" ? "" : "VGA,GEV"))
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
);

function parseEnvMs(name: string, fallback: number, min: number, max: number): number {
  const rawValue = process.env[name];
  if (typeof rawValue !== "string" || rawValue.trim() === "") return fallback;
  const raw = Number(rawValue);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(raw)));
}

const DETAIL_PRICE_HISTORY_COLUMNS = "sessionDate,price,dailyReturn,portfolioSize,investorCount";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${tag}_timeout_${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function normalizeHistorySessionDate(date: Date): Date {
  return startOfUtcDay(new Date(date.getTime() + 3 * 60 * 60 * 1000));
}

function dedupeSessionPricePoints(rows: Array<{ date: Date; price: number }>): PricePoint[] {
  const sessions = new Map<number, PricePoint>();
  for (const row of rows) {
    if (!Number.isFinite(row.price) || row.price <= 0) continue;
    const sessionDate = normalizeHistorySessionDate(row.date);
    sessions.set(sessionDate.getTime(), { date: sessionDate, price: row.price });
  }
  return [...sessions.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

function buildHistoryRowsFromServingPayload(serving: FundDetailCoreServingPayload | null): {
  rowsDesc: FundHistoryRow[];
  pointCount: number;
  minIso: string;
  maxIso: string;
  coverageDays: number;
  downsampleMode: string;
  artifactVersion: number | null;
  artifactGeneratedAt: string | null;
  artifactSource: string | null;
} {
  if (!serving?.chartHistory?.points || !Array.isArray(serving.chartHistory.points)) {
    return {
      rowsDesc: [],
      pointCount: 0,
      minIso: "none",
      maxIso: "none",
      coverageDays: 0,
      downsampleMode: "none",
      artifactVersion: null,
      artifactGeneratedAt: null,
      artifactSource: null,
    };
  }
  const normalizedPoints = dedupeSessionPricePoints(
    serving.chartHistory.points
      .filter((point) => Number.isFinite(point?.t) && Number.isFinite(point?.p) && point.p > 0)
      .map((point) => ({ date: new Date(point.t), price: point.p }))
  );
  if (normalizedPoints.length < 2) {
    return {
      rowsDesc: [],
      pointCount: normalizedPoints.length,
      minIso: normalizedPoints[0] ? normalizedPoints[0].date.toISOString() : "none",
      maxIso:
        normalizedPoints[normalizedPoints.length - 1]
          ? normalizedPoints[normalizedPoints.length - 1]!.date.toISOString()
          : "none",
      coverageDays: 0,
      downsampleMode: serving.chartHistory.mode || "none",
      artifactVersion: Number.isFinite(serving.version) ? serving.version : null,
      artifactGeneratedAt: typeof serving.generatedAt === "string" ? serving.generatedAt : null,
      artifactSource: serving.chartHistory.metadata?.source ?? null,
    };
  }

  const originalByTs = new Map<number, (typeof serving.chartHistory.points)[number]>();
  for (const point of serving.chartHistory.points) {
    if (!Number.isFinite(point?.t)) continue;
    originalByTs.set(normalizeHistorySessionDate(new Date(point.t)).getTime(), point);
  }

  const rowsAsc: FundHistoryRow[] = [];
  for (let index = 0; index < normalizedPoints.length; index += 1) {
    const point = normalizedPoints[index]!;
    const prev = index > 0 ? normalizedPoints[index - 1] : null;
    const source = originalByTs.get(point.date.getTime());
    const derivedDailyReturn =
      prev && prev.price > 0 ? ((point.price - prev.price) / prev.price) * 100 : 0;
    rowsAsc.push({
      date: point.date,
      price: point.price,
      dailyReturn:
        source && Number.isFinite(Number(source.d)) ? Number(source.d) : derivedDailyReturn,
      portfolioSize:
        source && Number.isFinite(Number(source.s)) && Number(source.s) > 0 ? Number(source.s) : null,
      investorCount:
        source && Number.isFinite(Number(source.i)) && Number(source.i) >= 0 ? Math.round(Number(source.i)) : null,
    });
  }

  const minDate = rowsAsc[0]!.date;
  const maxDate = rowsAsc[rowsAsc.length - 1]!.date;
  const coverageDays = Math.max(0, Math.round((maxDate.getTime() - minDate.getTime()) / DAY_MS));
  return {
    rowsDesc: [...rowsAsc].reverse(),
    pointCount: rowsAsc.length,
    minIso: minDate.toISOString(),
    maxIso: maxDate.toISOString(),
    coverageDays,
    downsampleMode: serving.chartHistory.mode || "none",
    artifactVersion: Number.isFinite(serving.version) ? serving.version : null,
    artifactGeneratedAt: typeof serving.generatedAt === "string" ? serving.generatedAt : null,
    artifactSource: serving.chartHistory.metadata?.source ?? null,
  };
}

function extendServingHistoryRowsWithSyntheticAnchors(
  rowsDesc: FundHistoryRow[],
  latestSnapshot: { date: Date; price: number; yearlyReturn: number }
): FundHistoryRow[] {
  if (rowsDesc.length < 2) return rowsDesc;
  const yearlyReturn = Number(latestSnapshot.yearlyReturn);
  if (!Number.isFinite(yearlyReturn)) return rowsDesc;
  const baseDenominator = 1 + yearlyReturn / 100;
  if (!(baseDenominator > 0)) return rowsDesc;
  const ascRows = [...rowsDesc].reverse();
  const latest = ascRows[ascRows.length - 1];
  if (!latest || !(latest.price > 0)) return rowsDesc;
  const synthetic: FundHistoryRow[] = [];
  for (let year = 1; year <= 3; year += 1) {
    const syntheticPrice = latest.price / Math.pow(baseDenominator, year);
    if (!(Number.isFinite(syntheticPrice) && syntheticPrice > 0)) continue;
    synthetic.push({
      date: new Date(latest.date.getTime() - year * 365 * DAY_MS),
      price: syntheticPrice,
      dailyReturn: 0,
      portfolioSize: null,
      investorCount: null,
    });
  }
  if (synthetic.length === 0) return rowsDesc;
  const merged = new Map<number, FundHistoryRow>();
  for (const row of synthetic) {
    const ts = normalizeHistorySessionDate(row.date).getTime();
    merged.set(ts, { ...row, date: new Date(ts) });
  }
  for (const row of ascRows) {
    const ts = normalizeHistorySessionDate(row.date).getTime();
    merged.set(ts, { ...row, date: new Date(ts) });
  }
  return [...merged.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
}

function buildHistoryAssembliesFromDescRows(rowsDesc: FundHistoryRow[]): {
  ascHistory: FundHistoryRow[];
  historyPoints: PricePoint[];
  minSessionDate: Date | null;
  maxSessionDate: Date | null;
  sessionDays: number;
} {
  if (rowsDesc.length === 0) {
    return { ascHistory: [], historyPoints: [], minSessionDate: null, maxSessionDate: null, sessionDays: 0 };
  }
  const ascHistory = new Array<FundHistoryRow>(rowsDesc.length);
  const historyPoints: PricePoint[] = [];
  let lastSessionTs = Number.NaN;

  for (let index = 0; index < rowsDesc.length; index += 1) {
    const row = rowsDesc[rowsDesc.length - 1 - index]!;
    ascHistory[index] = row;
    if (!(Number.isFinite(row.price) && row.price > 0)) continue;
    const sessionDate = normalizeHistorySessionDate(row.date);
    const sessionTs = sessionDate.getTime();
    if (Number.isFinite(lastSessionTs) && sessionTs === lastSessionTs) {
      historyPoints[historyPoints.length - 1] = { date: sessionDate, price: row.price };
      continue;
    }
    historyPoints.push({ date: sessionDate, price: row.price });
    lastSessionTs = sessionTs;
  }

  return {
    ascHistory,
    historyPoints,
    minSessionDate: historyPoints[0]?.date ?? null,
    maxSessionDate: historyPoints[historyPoints.length - 1]?.date ?? null,
    sessionDays: historyPoints.length,
  };
}

type HistorySeriesUsability = "full" | "partial" | "no_data";

type HistorySeriesCandidateSource = "live_history" | "snapshot_history" | "serving_history" | "serving_synthetic";

type HistorySeriesCandidate = {
  source: HistorySeriesCandidateSource;
  label: string;
  rowsDesc: FundHistoryRow[];
  downsampleMode: string;
};

type HistorySeriesQuality = {
  usability: HistorySeriesUsability;
  pointCount: number;
  coverageDays: number;
  gapRatio: number;
  maxGapDays: number;
  freshnessDays: number;
  score: number;
};

type RankedHistorySeriesCandidate = {
  candidate: HistorySeriesCandidate;
  quality: HistorySeriesQuality;
};

type RenderableSeriesState = "full" | "partial" | "no_data";

type TrendSeriesQuality = {
  state: RenderableSeriesState;
  pointCount: number;
  coverageDays: number;
  gapRatio: number;
  freshnessDays: number;
  minIso: string;
  maxIso: string;
};

type TrendSeriesPairQuality = {
  investor: TrendSeriesQuality;
  portfolio: TrendSeriesQuality;
  state: RenderableSeriesState;
  score: number;
};

type RankedTrendSeriesCandidate = {
  candidate: HistorySeriesCandidate;
  quality: TrendSeriesPairQuality;
};

function historySeriesUsabilityRank(usability: HistorySeriesUsability): number {
  if (usability === "full") return 3;
  if (usability === "partial") return 2;
  return 1;
}

function historySeriesSourcePriority(source: HistorySeriesCandidateSource): number {
  // Serving artifact her zaman birincil kaynak; canlı history yalnızca son çare.
  if (source === "serving_history") return 4;
  if (source === "serving_synthetic") return 3;
  if (source === "snapshot_history") return 2;
  return 1;
}

function evaluateHistorySeriesQuality(
  rowsDesc: FundHistoryRow[],
  snapshotDate: Date | null,
  downsampleMode: string
): HistorySeriesQuality {
  const points = dedupeSessionPricePoints(
    [...rowsDesc]
      .reverse()
      .map((row) => ({ date: row.date, price: row.price }))
  );
  const pointCount = points.length;
  if (pointCount < 2) {
    return {
      usability: "no_data",
      pointCount,
      coverageDays: 0,
      gapRatio: 1,
      maxGapDays: 0,
      freshnessDays: Number.POSITIVE_INFINITY,
      score: -100_000,
    };
  }

  const firstTs = points[0]!.date.getTime();
  const lastTs = points[pointCount - 1]!.date.getTime();
  const coverageDays = Math.max(0, Math.round((lastTs - firstTs) / DAY_MS));
  const gapDays: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const prevTs = points[index - 1]!.date.getTime();
    const currentTs = points[index]!.date.getTime();
    const days = Math.max(1, Math.round((currentTs - prevTs) / DAY_MS));
    gapDays.push(days);
  }
  const longGapCount = gapDays.filter((days) => days > DETAIL_CHART_GAP_THRESHOLD_DAYS).length;
  const gapRatio = gapDays.length > 0 ? longGapCount / gapDays.length : 0;
  const maxGapDays = gapDays.length > 0 ? Math.max(...gapDays) : 0;
  const anchorTs = snapshotDate ? snapshotDate.getTime() : lastTs;
  const freshnessDays = Math.max(0, Math.round((anchorTs - lastTs) / DAY_MS));
  const snapshotCompactMode = downsampleMode.startsWith("snapshot_compact");
  const fullGapRatioThreshold = DETAIL_CHART_FULL_MAX_GAP_RATIO_PCT / 100;
  const fullUsable =
    pointCount >= DETAIL_CHART_FULL_MIN_POINTS &&
    coverageDays >= DETAIL_CHART_FULL_MIN_COVERAGE_DAYS &&
    gapRatio <= fullGapRatioThreshold &&
    freshnessDays <= DETAIL_CHART_FULL_MAX_FRESHNESS_DAYS &&
    (DETAIL_HISTORY_SERVING_ACCEPT_SNAPSHOT_COMPACT || !snapshotCompactMode);
  const partialUsable = pointCount >= 2;
  const usability: HistorySeriesUsability = fullUsable ? "full" : partialUsable ? "partial" : "no_data";

  const continuityScore = Math.max(0, 1 - gapRatio);
  let score =
    pointCount * 8 +
    Math.min(coverageDays, DETAIL_HISTORY_LOOKBACK_DAYS) * 0.45 +
    continuityScore * 180 -
    freshnessDays * 2;
  if (snapshotCompactMode) score -= 140;
  if (maxGapDays > DETAIL_CHART_GAP_THRESHOLD_DAYS) {
    const boundedGapDays = Math.min(maxGapDays, DETAIL_HISTORY_LOOKBACK_DAYS);
    score -= (boundedGapDays - DETAIL_CHART_GAP_THRESHOLD_DAYS) * 0.8;
  }
  if (pointCount < DETAIL_CHART_PARTIAL_MIN_POINTS) {
    score -= (DETAIL_CHART_PARTIAL_MIN_POINTS - pointCount) * 18;
  }
  if (coverageDays < DETAIL_CHART_FULL_MIN_COVERAGE_DAYS) {
    score -= (DETAIL_CHART_FULL_MIN_COVERAGE_DAYS - coverageDays) * 0.35;
  }
  if (usability === "full") score += 320;
  if (usability === "no_data") score -= 100_000;

  return {
    usability,
    pointCount,
    coverageDays,
    gapRatio,
    maxGapDays,
    freshnessDays,
    score,
  };
}

function rankHistorySeriesCandidates(
  candidates: HistorySeriesCandidate[],
  snapshotDate: Date | null
): { selected: RankedHistorySeriesCandidate | null; ranked: RankedHistorySeriesCandidate[] } {
  const ranked = candidates
    .filter((candidate) => candidate.rowsDesc.length >= 2)
    .map((candidate) => ({
      candidate,
      quality: evaluateHistorySeriesQuality(candidate.rowsDesc, snapshotDate, candidate.downsampleMode),
    }))
    .sort((a, b) => {
      const usabilityDelta =
        historySeriesUsabilityRank(b.quality.usability) - historySeriesUsabilityRank(a.quality.usability);
      if (usabilityDelta !== 0) return usabilityDelta;
      const sourceDelta = historySeriesSourcePriority(b.candidate.source) - historySeriesSourcePriority(a.candidate.source);
      if (sourceDelta !== 0) return sourceDelta;
      if (b.quality.score !== a.quality.score) return b.quality.score - a.quality.score;
      if (b.quality.pointCount !== a.quality.pointCount) return b.quality.pointCount - a.quality.pointCount;
      if (b.quality.coverageDays !== a.quality.coverageDays) return b.quality.coverageDays - a.quality.coverageDays;
      if (a.quality.gapRatio !== b.quality.gapRatio) return a.quality.gapRatio - b.quality.gapRatio;
      return 0;
    });

  const selected = ranked[0] ?? null;
  return { selected, ranked };
}

function renderableSeriesRank(state: RenderableSeriesState): number {
  if (state === "full") return 3;
  if (state === "partial") return 2;
  return 1;
}

function normalizeTrendSeriesPoints(
  points: FundDetailTrendPoint[],
  kind: "investor" | "portfolio"
): FundDetailTrendPoint[] {
  if (points.length === 0) return [];
  const sorted = [...points]
    .filter((point) => Number.isFinite(point?.t) && Number.isFinite(point?.v))
    .sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return [];

  const byTimestamp = new Map<number, number>();
  for (const point of sorted) {
    if (kind === "portfolio") {
      if (!(point.v > 0)) continue;
    } else if (point.v < 0) {
      continue;
    }
    byTimestamp.set(point.t, kind === "investor" ? Math.max(0, Math.round(point.v)) : point.v);
  }
  if (byTimestamp.size === 0) return [];

  const deduped = [...byTimestamp.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t, v }));

  const out: FundDetailTrendPoint[] = [];
  for (let index = 0; index < deduped.length; index += 1) {
    const point = deduped[index]!;
    const prevRaw = index > 0 ? deduped[index - 1]! : null;
    if (prevRaw && prevRaw.v > 0) {
      const ratio = point.v / prevRaw.v;
      const tooLarge = ratio > DETAIL_TREND_OUTLIER_MAX_JUMP_RATIO;
      const tooSmall = ratio < 1 / DETAIL_TREND_OUTLIER_MAX_JUMP_RATIO;
      if (tooLarge || tooSmall) continue;
    }
    out.push(point);
  }
  return out;
}

function evaluateTrendSeriesQuality(
  points: FundDetailTrendPoint[],
  snapshotDate: Date | null
): TrendSeriesQuality {
  const sorted = [...points]
    .filter((point) => Number.isFinite(point?.t) && Number.isFinite(point?.v))
    .sort((a, b) => a.t - b.t);
  const pointCount = sorted.length;
  if (pointCount < 2) {
    return {
      state: pointCount === 1 ? "partial" : "no_data",
      pointCount,
      coverageDays: 0,
      gapRatio: 1,
      freshnessDays: Number.POSITIVE_INFINITY,
      minIso: sorted[0] ? new Date(sorted[0].t).toISOString() : "none",
      maxIso: sorted[sorted.length - 1] ? new Date(sorted[sorted.length - 1]!.t).toISOString() : "none",
    };
  }
  const firstT = sorted[0]!.t;
  const lastT = sorted[sorted.length - 1]!.t;
  const coverageDays = Math.max(0, Math.round((lastT - firstT) / DAY_MS));
  let longGapCount = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const gapDays = Math.max(1, Math.round((sorted[index]!.t - sorted[index - 1]!.t) / DAY_MS));
    if (gapDays > DETAIL_CHART_GAP_THRESHOLD_DAYS) longGapCount += 1;
  }
  const gapRatio = sorted.length > 1 ? longGapCount / (sorted.length - 1) : 1;
  const anchorTs = snapshotDate ? snapshotDate.getTime() : lastT;
  const freshnessDays = Math.max(0, Math.round((anchorTs - lastT) / DAY_MS));
  const fullState =
    pointCount >= DETAIL_TREND_FULL_MIN_POINTS &&
    coverageDays >= DETAIL_TREND_FULL_MIN_COVERAGE_DAYS &&
    gapRatio <= DETAIL_CHART_FULL_MAX_GAP_RATIO_PCT / 100 &&
    freshnessDays <= DETAIL_CHART_FULL_MAX_FRESHNESS_DAYS * 2;
  const state: RenderableSeriesState = fullState ? "full" : pointCount >= 2 ? "partial" : "no_data";
  return {
    state,
    pointCount,
    coverageDays,
    gapRatio,
    freshnessDays,
    minIso: new Date(firstT).toISOString(),
    maxIso: new Date(lastT).toISOString(),
  };
}

function evaluateTrendSeriesPairQuality(
  trend: { investorCount: FundDetailTrendPoint[]; portfolioSize: FundDetailTrendPoint[] },
  snapshotDate: Date | null
): TrendSeriesPairQuality {
  const investor = evaluateTrendSeriesQuality(trend.investorCount, snapshotDate);
  const portfolio = evaluateTrendSeriesQuality(trend.portfolioSize, snapshotDate);
  const pairState: RenderableSeriesState =
    investor.state === "full" && portfolio.state === "full"
      ? "full"
      : investor.pointCount >= 2 || portfolio.pointCount >= 2
        ? "partial"
        : "no_data";
  const score =
    investor.pointCount * 6 +
    portfolio.pointCount * 6 +
    Math.min(investor.coverageDays, portfolio.coverageDays) * 0.35 +
    Math.max(0, 1 - investor.gapRatio) * 80 +
    Math.max(0, 1 - portfolio.gapRatio) * 80 -
    (investor.freshnessDays + portfolio.freshnessDays) * 1.2 +
    renderableSeriesRank(pairState) * 200;
  return { investor, portfolio, state: pairState, score };
}

function rankTrendSeriesCandidates(
  candidates: HistorySeriesCandidate[],
  snapshotDate: Date | null
): { selected: RankedTrendSeriesCandidate | null; ranked: RankedTrendSeriesCandidate[] } {
  const ranked = candidates
    .filter((candidate) => candidate.rowsDesc.length >= 2)
    .map((candidate) => {
      const rowsAsc = [...candidate.rowsDesc].reverse();
      const trend = buildTrendSeries(rowsAsc);
      const normalized = {
        investorCount: normalizeTrendSeriesPoints(trend.investorCount, "investor"),
        portfolioSize: normalizeTrendSeriesPoints(trend.portfolioSize, "portfolio"),
      };
      return {
        candidate,
        quality: evaluateTrendSeriesPairQuality(normalized, snapshotDate),
      };
    })
    .sort((a, b) => {
      const stateDelta = renderableSeriesRank(b.quality.state) - renderableSeriesRank(a.quality.state);
      if (stateDelta !== 0) return stateDelta;
      const sourceDelta = historySeriesSourcePriority(b.candidate.source) - historySeriesSourcePriority(a.candidate.source);
      if (sourceDelta !== 0) return sourceDelta;
      if (b.quality.score !== a.quality.score) return b.quality.score - a.quality.score;
      if (b.quality.investor.pointCount !== a.quality.investor.pointCount) {
        return b.quality.investor.pointCount - a.quality.investor.pointCount;
      }
      if (b.quality.portfolio.pointCount !== a.quality.portfolio.pointCount) {
        return b.quality.portfolio.pointCount - a.quality.portfolio.pointCount;
      }
      return 0;
    });

  return { selected: ranked[0] ?? null, ranked };
}

function downsampleTimeSeries<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points;
  if (maxPoints <= 2) return [points[0]!, points[points.length - 1]!];

  const result: T[] = [points[0]!];
  const middleCount = maxPoints - 2;
  const lastIndex = points.length - 1;
  for (let index = 1; index <= middleCount; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (middleCount + 1));
    const point = points[sourceIndex];
    if (point && point !== result[result.length - 1]) {
      result.push(point);
    }
  }
  if (result[result.length - 1] !== points[lastIndex]) {
    result.push(points[lastIndex]!);
  }
  return result;
}

function parseSparklinePrices(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => (typeof value === "number" ? value : Number(value)))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function buildSparklinePricePoints(anchorDate: Date, raw: unknown): PricePoint[] {
  const spark = parseSparklinePrices(raw);
  if (spark.length < 2) return [];
  const end = normalizeHistorySessionDate(anchorDate).getTime();
  const start = end - (spark.length - 1) * DAY_MS;
  return spark.map((price, index) => ({
    date: new Date(start + index * DAY_MS),
    price,
  }));
}

function buildApproxPricePointsFromReturns(
  anchorDate: Date,
  lastPrice: number,
  monthlyReturn: number,
  yearlyReturn: number
): PricePoint[] {
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return [];
  const points: PricePoint[] = [];
  const endDate = normalizeHistorySessionDate(anchorDate);
  points.push({ date: endDate, price: lastPrice });

  if (Number.isFinite(monthlyReturn)) {
    const denom = 1 + monthlyReturn / 100;
    const monthlyBase = denom > 0 ? lastPrice / denom : NaN;
    if (Number.isFinite(monthlyBase) && monthlyBase > 0) {
      points.push({ date: new Date(endDate.getTime() - 31 * DAY_MS), price: monthlyBase });
    }
  }

  if (Number.isFinite(yearlyReturn)) {
    const denom = 1 + yearlyReturn / 100;
    const yearlyBase = denom > 0 ? lastPrice / denom : NaN;
    if (Number.isFinite(yearlyBase) && yearlyBase > 0) {
      points.push({ date: new Date(endDate.getTime() - 365 * DAY_MS), price: yearlyBase });
    }
  }

  const byTime = new Map<number, PricePoint>();
  for (const point of points) {
    byTime.set(point.date.getTime(), point);
  }
  return [...byTime.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

const RISK_LEVELS: RiskLevel[] = ["very_low", "low", "medium", "high", "very_high"];

function parseRiskLevel(raw: string | null | undefined): RiskLevel | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim() as RiskLevel;
  return RISK_LEVELS.includes(s) ? s : null;
}

function parseFundMetricsJson(value: unknown): FundMetrics | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k] as number) ? (o[k] as number) : null);
  if (n("volatility") == null && n("maxDrawdown") == null) return null;
  return {
    totalReturn: n("totalReturn") ?? 0,
    annualizedReturn: n("annualizedReturn") ?? 0,
    volatility: n("volatility") ?? 0,
    maxDrawdown: n("maxDrawdown") ?? 0,
    sharpeRatio: n("sharpeRatio") ?? 0,
    sortinoRatio: n("sortinoRatio") ?? 0,
    calmarRatio: n("calmarRatio") ?? 0,
    winRate: n("winRate") ?? 0,
    avgGain: n("avgGain") ?? 0,
    avgLoss: n("avgLoss") ?? 0,
    dataPoints: Math.round(n("dataPoints") ?? 0),
  };
}


export type FundDetailPricePoint = { t: number; p: number };
export type FundDetailTrendPoint = { t: number; v: number };

export type FundDetailSimilarFund = {
  code: string;
  name: string;
  shortName: string | null;
  lastPrice: number;
  dailyReturn: number;
  yearlyReturn: number;
  logoUrl: string | null;
  /** Seçim notu; alternatifler bloğunda tek satır, sakin ton. */
  reasonLabel: string;
};

/** Fiyat geçmişinden türetilen özetler (risk bölümü). */
export type FundDetailDerivedSummary = {
  /** Son gözlemden geriye ~365 gün veya mevcut seri başı. */
  returnApprox1YearPct: number | null;
  /** Son gözlemden geriye ~730 gün veya mevcut seri başı. */
  returnApprox2YearPct: number | null;
  /** Son gözlemden geriye ~1095 gün veya mevcut seri başı. */
  returnApprox3YearPct: number | null;
  /** Ardışık ~21 işlem günü pencereleri içinde en yüksek birikimli getiri (%). */
  bestRollingMonthPct: number | null;
  /** Aynı tanım için en düşük birikimli getiri (%). */
  worstRollingMonthPct: number | null;
};

/** Aynı günlük kesitte kategorideki diğer fonların TEFAS getiri ortalaması (bu fon hariç). */
export type FundCategoryReturnAverages = {
  sampleSize: number;
  avgDailyReturn: number | null;
  avgMonthlyReturn: number | null;
  avgYearlyReturn: number | null;
};

const MIN_CATEGORY_RETURN_SAMPLE = 5;

async function loadCategoryReturnAverages(
  fundId: string,
  categoryCode: string | null | undefined,
  snapshotDate: Date | null | undefined
): Promise<FundCategoryReturnAverages | null> {
  const code = typeof categoryCode === "string" ? categoryCode.trim() : "";
  if (!code || !snapshotDate) return null;
  const where = { categoryCode: code, date: snapshotDate, fundId: { not: fundId } };
  const agg = await prisma.fundDailySnapshot.aggregate({
    where,
    _avg: { dailyReturn: true, monthlyReturn: true, yearlyReturn: true },
    _count: { _all: true },
  });
  const count = agg._count._all;
  if (count < MIN_CATEGORY_RETURN_SAMPLE) return null;
  return {
    sampleSize: count,
    avgDailyReturn: agg._avg.dailyReturn,
    avgMonthlyReturn: agg._avg.monthlyReturn,
    avgYearlyReturn: agg._avg.yearlyReturn,
  };
}

async function listFundDetailFundsListAlternatives(
  currentCode: string,
  categoryCode: string | null | undefined,
  limit: number
): Promise<FundAlternativeCandidate[]> {
  const normalizedCode = currentCode.trim().toUpperCase();
  const normalizedCategory = (categoryCode ?? "").trim();
  if (!normalizedCode || !normalizedCategory) return [];
  const page = await withTimeout(
    getFundsPage({
      page: 1,
      pageSize: Math.max(limit + 1, FUND_ALTERNATIVES_CANDIDATE_POOL + 1),
      q: "",
      category: normalizedCategory,
      fundType: undefined,
      sortField: "portfolioSize",
      sortDir: "desc",
    }),
    DETAIL_ALTERNATIVES_FUNDS_LIST_FALLBACK_TIMEOUT_MS,
    "fund_detail_alternatives_funds_list_fallback"
  ).catch(() => null);
  if (!page?.items?.length) return [];
  return page.items
    .filter((row) => row.code.trim().toUpperCase() !== normalizedCode)
    .slice(0, limit)
    .map((row) => ({
      code: row.code,
      name: row.name,
      shortName: row.shortName,
      lastPrice: row.lastPrice,
      dailyReturn: row.dailyReturn,
      logoUrl: getFundLogoUrlForUi(row.id, row.code, row.logoUrl, row.name),
      portfolioSize: row.portfolioSize,
      investorCount: row.investorCount,
      monthlyReturn: row.monthlyReturn,
      yearlyReturn: row.yearlyReturn,
    }));
}

export type FundDetailPageData = {
  fund: {
    code: string;
    name: string;
    shortName: string | null;
    description: string | null;
    lastPrice: number;
    dailyReturn: number;
    weeklyReturn: number;
    monthlyReturn: number;
    yearlyReturn: number;
    portfolioSize: number;
    investorCount: number;
    category: { code: string; name: string } | null;
    fundType: { code: number; name: string } | null;
    logoUrl: string | null;
    lastUpdatedAt: string | null;
    updatedAt: string;
    portfolioManagerInferred: string | null;
  };
  snapshotDate: string | null;
  snapshotAlpha: number | null;
  riskLevel: RiskLevel | null;
  snapshotMetrics: FundMetrics | null;
  priceSeries: FundDetailPricePoint[];
  historyMetrics: FundMetrics | null;
  bestWorstDay: { bestPct: number; worstPct: number } | null;
  /** Skorlama modelindeki kategori referans kodu; resmi fon benchmark’ı değildir. */
  modelBenchmark: { code: string; label: string } | null;
  /** TEFAS yurt içi fonları için standart işlem birimi. */
  tradingCurrency: "TRY";
  derivedSummary: FundDetailDerivedSummary;
  similarFunds: FundDetailSimilarFund[];
  /**
   * Aynı kategorideki geniş aday havuzunun günlük getirileri (içgörü istatistiği).
   * UI’da kullanılmaz; `similarFunds` seçkisi dar tutulduğunda medyan vb. için.
   */
  similarCategoryPeerDailyReturns: number[];
  categoryReturnAverages: FundCategoryReturnAverages | null;
  /** Veri tabanı referans serileri + kategori türev ortalaması ile kıyas; yoksa UI eski TEFAS kıyasına döner. */
  kiyasBlock: FundKiyasViewPayload | null;
  trendSeries: {
    portfolioSize: FundDetailTrendPoint[];
    investorCount: FundDetailTrendPoint[];
  };
  degraded?: {
    active: boolean;
    stale: boolean;
    partial: boolean;
    reasons: string[];
    failedSteps: string[];
    generatedAt: string;
  };
};

type DetailStepDurations = Record<string, number>;

type DetailCacheKind = "core_full" | "core_degraded" | "full_optional_enriched" | "emergency";

type DetailCacheEntry = {
  payload: FundDetailPageData;
  updatedAt: number;
  kind: DetailCacheKind;
  freshTtlMs: number;
  staleTtlMs: number;
};

type DetailRuntimeState = {
  cache: Map<string, DetailCacheEntry>;
  inFlight: Map<string, Promise<FundDetailPageData | null>>;
  phase2InFlight: Map<string, Promise<FundDetailPageData | null>>;
  phase2ActiveCount: number;
  phase2Queue: Array<() => void>;
  phase2SnapshotSeed: Map<
    string,
    {
      row: LatestSnapshotCoreRow;
      source: "phase1_serving" | "phase1_snapshot";
      cachedAt: number;
    }
  >;
  failureUntil: Map<string, number>;
  sectionStates: Map<
    string,
    {
      states: FundDetailSectionStates;
      loggedAt: number;
    }
  >;
};

type GlobalWithDetailState = typeof globalThis & {
  __fundDetailRuntimeState?: DetailRuntimeState;
};

function getDetailRuntimeState(): DetailRuntimeState {
  const g = globalThis as GlobalWithDetailState;
  if (!g.__fundDetailRuntimeState) {
    g.__fundDetailRuntimeState = {
      cache: new Map<string, DetailCacheEntry>(),
      inFlight: new Map<string, Promise<FundDetailPageData | null>>(),
      phase2InFlight: new Map<string, Promise<FundDetailPageData | null>>(),
      phase2ActiveCount: 0,
      phase2Queue: [],
      phase2SnapshotSeed: new Map(),
      failureUntil: new Map<string, number>(),
      sectionStates: new Map(),
    };
  }
  return g.__fundDetailRuntimeState;
}

function setPhase2SnapshotSeed(
  state: DetailRuntimeState,
  code: string,
  row: LatestSnapshotCoreRow,
  source: "phase1_serving" | "phase1_snapshot"
): void {
  state.phase2SnapshotSeed.set(code, { row, source, cachedAt: Date.now() });
  trimMapOldestEntries(state.phase2SnapshotSeed, DETAIL_HOT_READ_CACHE_MAX_KEYS);
}

function getPhase2SnapshotSeed(
  state: DetailRuntimeState,
  code: string
): { row: LatestSnapshotCoreRow; source: "phase1_serving" | "phase1_snapshot" } | null {
  const seeded = state.phase2SnapshotSeed.get(code);
  if (!seeded) return null;
  if (Date.now() - seeded.cachedAt > DETAIL_PHASE2_REQUEST_SEED_TTL_MS) {
    state.phase2SnapshotSeed.delete(code);
    return null;
  }
  return { row: seeded.row, source: seeded.source };
}

async function primePhase2HistoryRead(
  state: DetailRuntimeState,
  code: string
): Promise<{
  primed: boolean;
  reason: "ok" | "no_seed" | "cache_hit" | "disabled";
  waitedMs: number;
}> {
  if (!DETAIL_PHASE2_HISTORY_PRIME_ENABLED) {
    return { primed: false, reason: "disabled", waitedMs: 0 };
  }
  const seed = getPhase2SnapshotSeed(state, code);
  if (!seed) {
    return { primed: false, reason: "no_seed", waitedMs: 0 };
  }
  const params = {
    fundId: seed.row.fundId,
    fromDate: new Date(seed.row.date.getTime() - DETAIL_HISTORY_LOOKBACK_DAYS * DAY_MS),
    toDate: seed.row.date,
    limit: DETAIL_HISTORY_FETCH_LIMIT,
  };
  const hot = getDetailHotReadState();
  const cacheKey = buildPriceHistoryCacheKey(params);
  const cached = hot.historyCache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt <= DETAIL_HISTORY_CACHE_TTL_MS) {
    return { primed: false, reason: "cache_hit", waitedMs: 0 };
  }

  const waitBudgetMs = Math.max(0, DETAIL_PHASE2_HISTORY_PRIME_WAIT_MS);
  const startedAt = Date.now();
  const primePromise = loadPriceHistoryBySessionLeanCached(params)
    .then(() => undefined)
    .catch(() => undefined);
  if (waitBudgetMs > 0) {
    await Promise.race([
      primePromise,
      new Promise<void>((resolve) => setTimeout(resolve, waitBudgetMs)),
    ]);
  }
  return { primed: true, reason: "ok", waitedMs: Date.now() - startedAt };
}

async function runWithPhase2ConcurrencyLimit<T>(
  state: DetailRuntimeState,
  task: (queueWaitMs: number) => Promise<T>
): Promise<T> {
  const queuedAt = Date.now();
  await new Promise<void>((resolve) => {
    const start = () => {
      state.phase2ActiveCount += 1;
      resolve();
    };
    if (state.phase2ActiveCount < DETAIL_PHASE2_MAX_CONCURRENCY) {
      start();
      return;
    }
    state.phase2Queue.push(start);
  });
  const queueWaitMs = Date.now() - queuedAt;
  try {
    return await task(queueWaitMs);
  } finally {
    state.phase2ActiveCount = Math.max(0, state.phase2ActiveCount - 1);
    const next = state.phase2Queue.shift();
    if (next) next();
  }
}

function pickFreshDetailCache(code: string): DetailCacheEntry | null {
  const entry = getDetailRuntimeState().cache.get(code);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > entry.freshTtlMs) return null;
  return entry;
}

function pickStaleDetailCache(code: string): DetailCacheEntry | null {
  const entry = getDetailRuntimeState().cache.get(code);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > entry.staleTtlMs) return null;
  return entry;
}

function resolveCachePolicy(kind: DetailCacheKind): { freshTtlMs: number; staleTtlMs: number } {
  if (kind === "emergency") {
    return { freshTtlMs: DETAIL_EMERGENCY_FRESH_TTL_MS, staleTtlMs: DETAIL_EMERGENCY_STALE_TTL_MS };
  }
  if (kind === "core_degraded") {
    return { freshTtlMs: DETAIL_DEGRADED_FRESH_TTL_MS, staleTtlMs: DETAIL_DEGRADED_STALE_TTL_MS };
  }
  return { freshTtlMs: DETAIL_FRESH_TTL_MS, staleTtlMs: DETAIL_STALE_TTL_MS };
}

function hasRequiredCoreData(payload: FundDetailPageData): boolean {
  return (
    typeof payload.snapshotDate === "string" &&
    payload.snapshotDate.length > 0 &&
    Number.isFinite(payload.fund.lastPrice) &&
    payload.fund.lastPrice > 0 &&
    Number.isFinite(payload.fund.investorCount) &&
    payload.fund.investorCount > 0 &&
    Number.isFinite(payload.fund.portfolioSize) &&
    payload.fund.portfolioSize > 0 &&
    payload.priceSeries.length >= 2 &&
    payload.trendSeries.investorCount.length >= 2 &&
    payload.trendSeries.portfolioSize.length >= 2
  );
}

function hasOptionalEnrichment(payload: FundDetailPageData): boolean {
  return (
    payload.similarFunds.length > 0 ||
    payload.similarCategoryPeerDailyReturns.length > 0 ||
    payload.categoryReturnAverages != null ||
    payload.kiyasBlock != null
  );
}

function needsPhase2OptionalRefresh(payload: FundDetailPageData): boolean {
  return payload.kiyasBlock == null;
}

function inferCacheKind(payload: FundDetailPageData): DetailCacheKind {
  const reasons = payload.degraded?.reasons ?? [];
  const hasEmergencyReason = reasons.some((reason) => reason.includes("emergency"));
  if (hasEmergencyReason || (!payload.snapshotDate && payload.priceSeries.length === 0)) {
    return "emergency";
  }
  const sectionStates = deriveFundDetailSectionStates(payload);
  const coreHealthy =
    sectionStates.performance === "full" &&
    sectionStates.trends !== "no_data" &&
    payload.priceSeries.length >= DETAIL_CHART_PARTIAL_MIN_POINTS;
  if (hasOptionalEnrichment(payload) && !payload.degraded?.active && coreHealthy) return "full_optional_enriched";
  if (!coreHealthy) return "core_degraded";
  if (hasRequiredCoreData(payload)) return payload.degraded?.active ? "core_degraded" : "core_full";
  return "core_degraded";
}

function writeDetailCache(
  state: DetailRuntimeState,
  code: string,
  payload: FundDetailPageData,
  forcedKind?: DetailCacheKind
): { kind: DetailCacheKind; freshTtlMs: number; staleTtlMs: number } {
  const kind = forcedKind ?? inferCacheKind(payload);
  const policy = resolveCachePolicy(kind);
  state.cache.set(code, {
    payload,
    updatedAt: Date.now(),
    kind,
    freshTtlMs: policy.freshTtlMs,
    staleTtlMs: policy.staleTtlMs,
  });
  return { kind, freshTtlMs: policy.freshTtlMs, staleTtlMs: policy.staleTtlMs };
}

function servedCacheKind(entry: DetailCacheEntry): "core_full" | "core_degraded" | "full_optional_enriched" | "emergency" {
  if (entry.kind === "core_full") return "core_full";
  if (entry.kind === "full_optional_enriched") return "full_optional_enriched";
  if (entry.kind === "emergency") return "emergency";
  return "core_degraded";
}

function cacheKindPriority(kind: DetailCacheKind): number {
  if (kind === "full_optional_enriched") return 4;
  if (kind === "core_full") return 3;
  if (kind === "core_degraded") return 2;
  return 1;
}

function sectionStateRank(state: FundDetailSectionState): number {
  if (state === "full") return 3;
  if (state === "partial") return 2;
  return 1;
}

function payloadCacheQualityScore(payload: FundDetailPageData): number {
  const sections = deriveFundDetailSectionStates(payload);
  const comparisonRefs = payload.kiyasBlock?.refs.length ?? 0;
  const reasons = payload.degraded?.reasons ?? [];
  const syntheticSeriesPenalty = reasons.includes("history_serving_synthetic_extension") ? 2_500 : 0;
  return (
    sectionStateRank(sections.performance) * 10_000 +
    sectionStateRank(sections.trends) * 4_500 +
    sectionStateRank(sections.comparison) * 2_000 +
    payload.priceSeries.length * 15 +
    payload.trendSeries.investorCount.length * 8 +
    payload.trendSeries.portfolioSize.length * 8 +
    comparisonRefs * 40 -
    syntheticSeriesPenalty
  );
}

function shouldWriteCache(
  existing: DetailCacheEntry | undefined,
  incoming: DetailCacheKind,
  incomingPayload: FundDetailPageData
): boolean {
  if (!existing) return true;
  const incomingSnapshotTs = incomingPayload.snapshotDate ? new Date(incomingPayload.snapshotDate).getTime() : Number.NaN;
  const existingSnapshotTs = existing.payload.snapshotDate ? new Date(existing.payload.snapshotDate).getTime() : Number.NaN;
  const incomingSnapshotOk = Number.isFinite(incomingSnapshotTs);
  const existingSnapshotOk = Number.isFinite(existingSnapshotTs);
  // Aynı kalite sınıfında dahi daha güncel snapshot her zaman kazanmalı.
  if (incomingSnapshotOk && existingSnapshotOk) {
    if (incomingSnapshotTs > existingSnapshotTs) return true;
    if (incomingSnapshotTs < existingSnapshotTs) return false;
  } else if (incomingSnapshotOk && !existingSnapshotOk) {
    return true;
  } else if (!incomingSnapshotOk && existingSnapshotOk) {
    return false;
  }
  const incomingPriority = cacheKindPriority(incoming);
  const existingPriority = cacheKindPriority(existing.kind);
  if (incomingPriority > existingPriority) return true;
  if (incomingPriority < existingPriority) return false;
  return payloadCacheQualityScore(incomingPayload) >= payloadCacheQualityScore(existing.payload);
}

/**
 * Bu nedenler tek başına veya birlikte “yenileme bekleniyor” (degraded.active) tetiklememeli:
 * - kaynak etiketi (serving/history/…)
 * - trend / anlık sayaç eksikleri: veri yok kısmi gösterim; sonsuz upgrading etiketi üretir.
 */
function isNonBlockingDetailDegradedReason(reason: string): boolean {
  if (reason.startsWith("core_price_series_source_")) return true;
  return (
    reason === "core_investor_trend_missing" ||
    reason === "core_portfolio_trend_missing" ||
    reason === "core_investor_current_missing" ||
    reason === "core_portfolio_current_missing" ||
    reason === "history_series_quality_partial" ||
    reason === "history_serving_insufficient_coverage" ||
    reason === "history_serving_insufficient_points" ||
    reason === "history_serving_sparse_mode" ||
    reason === "history_serving_quality_below_full" ||
    reason === "history_serving_no_live_rows"
  );
}

function hasMaterialDetailDegradeSignals(reasons: string[], failedSteps: string[]): boolean {
  if (failedSteps.length > 0) return true;
  return reasons.some((r) => !isNonBlockingDetailDegradedReason(r));
}

function withDegradedPayload(
  payload: FundDetailPageData,
  input: { stale: boolean; partial: boolean; reasons: string[]; failedSteps: string[] }
): FundDetailPageData {
  const material = hasMaterialDetailDegradeSignals(input.reasons, input.failedSteps);
  return {
    ...payload,
    degraded: {
      active: material,
      stale: input.stale,
      partial: material && input.partial,
      reasons: input.reasons,
      failedSteps: input.failedSteps,
      generatedAt: new Date().toISOString(),
    },
  };
}

function shouldLogFundDetailDebug(code: string): boolean {
  if (DETAIL_DEBUG_CODES.size === 0) return false;
  return DETAIL_DEBUG_CODES.has(code.trim().toUpperCase());
}

function trendSectionState(points: FundDetailTrendPoint[]): "full" | "single_point" | "unavailable" {
  if (points.length >= 2) return "full";
  if (points.length === 1) return "single_point";
  return "unavailable";
}

function riskSectionState(payload: FundDetailPageData): "full" | "partial" | "unavailable" {
  const metrics = payload.historyMetrics ?? payload.snapshotMetrics;
  const hasVol = metrics && Number.isFinite(metrics.volatility) && metrics.volatility > 0;
  const hasDrawdown = metrics && Number.isFinite(metrics.maxDrawdown) && metrics.maxDrawdown > 0;
  const hasReturn1y =
    payload.derivedSummary.returnApprox1YearPct != null &&
    Number.isFinite(payload.derivedSummary.returnApprox1YearPct);
  const hasReturn3y =
    payload.derivedSummary.returnApprox3YearPct != null &&
    Number.isFinite(payload.derivedSummary.returnApprox3YearPct);
  const signals = [hasVol, hasDrawdown, hasReturn1y, hasReturn3y].filter(Boolean).length;
  if (signals >= 2) return "full";
  if (signals === 1) return "partial";
  return "unavailable";
}

function countValidComparisonRefs(block: FundKiyasViewPayload | null): number {
  if (!block) return 0;
  let count = 0;
  for (const rows of Object.values(block.rowsByRef)) {
    const row = rows.find((item) => item.periodId === "1y");
    if (!row) continue;
    if (typeof row.fundPct === "number" && Number.isFinite(row.fundPct) && typeof row.refPct === "number" && Number.isFinite(row.refPct)) {
      count += 1;
    }
  }
  return count;
}

function emitFundDetailDebugLog(
  code: string,
  payload: FundDetailPageData,
  meta: {
    seriesSource: "history" | "snapshot_fallback" | "approx" | "serving";
    servingHit: boolean;
    servingMissReason?: string | null;
    managerSource: "none";
  }
): void {
  if (!shouldLogFundDetailDebug(code)) return;
  const investorTrendPoints = payload.trendSeries.investorCount.length;
  const portfolioTrendPoints = payload.trendSeries.portfolioSize.length;
  const comparisonValidRefs = countValidComparisonRefs(payload.kiyasBlock);
  const comparisonTotalRefs = payload.kiyasBlock?.refs.length ?? 0;
  const trendInvestor = trendSectionState(payload.trendSeries.investorCount);
  const trendPortfolio = trendSectionState(payload.trendSeries.portfolioSize);
  const comparisonState =
    comparisonTotalRefs === 0 ? "unavailable" : comparisonValidRefs > 0 ? "partial_or_full" : "unavailable";
  const riskState = riskSectionState(payload);
  console.info(
    `[fund-detail-debug] code=${code} series_source=${meta.seriesSource} serving_hit=${meta.servingHit ? 1 : 0} ` +
      `serving_miss_reason=${meta.servingMissReason ?? "none"} trend_investor_points=${investorTrendPoints} ` +
      `trend_portfolio_points=${portfolioTrendPoints} comparison_valid_refs=${comparisonValidRefs}/${comparisonTotalRefs} ` +
      `risk_inputs_history_points=${payload.priceSeries.length} risk_output_volatility=${payload.historyMetrics?.volatility ?? payload.snapshotMetrics?.volatility ?? -1} ` +
      `risk_output_drawdown=${payload.historyMetrics?.maxDrawdown ?? payload.snapshotMetrics?.maxDrawdown ?? -1} ` +
      `manager_source=${meta.managerSource} sections=trends:${trendInvestor}|portfolio:${trendPortfolio}|comparison:${comparisonState}|risk:${riskState}`
  );
}

function emitSectionStateTransitions(
  state: DetailRuntimeState,
  code: string,
  payload: FundDetailPageData,
  phase: "phase1" | "phase2"
): void {
  if (!shouldLogFundDetailDebug(code)) return;
  const next = deriveFundDetailSectionStates(payload);
  const previous = state.sectionStates.get(code);
  const now = Date.now();
  const sections: Array<keyof FundDetailSectionStates> = ["performance", "trends", "risk", "comparison"];

  if (!previous) {
    console.info(
      `[fund-detail-section-status] code=${code} phase=${phase} baseline=${JSON.stringify(next)} at=${new Date(now).toISOString()}`
    );
    state.sectionStates.set(code, { states: next, loggedAt: now });
    return;
  }

  for (const section of sections) {
    const fromState = previous.states[section] as FundDetailSectionState;
    const toState = next[section] as FundDetailSectionState;
    if (fromState === toState) continue;
    console.info(
      `[fund-detail-section-transition] code=${code} section=${section} from=${fromState} to=${toState} phase=${phase} ` +
        `at=${new Date(now).toISOString()} since_prev_ms=${now - previous.loggedAt}`
    );
  }
  state.sectionStates.set(code, { states: next, loggedAt: now });
}

type FundHistoryRow = {
  date: Date;
  price: number;
  dailyReturn: number;
  portfolioSize?: number | null;
  investorCount?: number | null;
};

type LatestSnapshotLeanResult = { row: LatestSnapshotCoreRow | null; dbExecMs: number | null };

type HistoryQueryResult = {
  rows: FundHistoryRow[];
  selectedFromIso: string;
  selectedToIso: string;
  source: "snapshot" | "history";
  dbExecMs: number | null;
  decodeMs: number;
  rawRows: number;
  queryCount: 1 | 2;
  queryPlan:
    | "full_distinct"
    | "snapshot_fastpath"
    | "snapshot_fastpath_after_live_failure"
    | "snapshot_fastpath_cooldown"
    | "snapshot_rest_fallback"
    | "raw_desc_js_dedupe"
    | "raw_desc_js_dedupe_full_fallback";
  columns: string;
  fallbackFailureCategory?: string | null;
  fallbackReason?: string | null;
  liveAttempted?: boolean;
};

type DetailHotReadState = {
  latestSnapshotCache: Map<string, { updatedAt: number; value: LatestSnapshotLeanResult }>;
  latestSnapshotInFlight: Map<string, Promise<LatestSnapshotLeanResult>>;
  historyCache: Map<string, { updatedAt: number; value: HistoryQueryResult }>;
  historyInFlight: Map<string, Promise<HistoryQueryResult>>;
  historyFailureUntil: Map<string, { until: number; category: string; updatedAt: number }>;
};

type GlobalWithDetailHotReadState = typeof globalThis & {
  __fundDetailHotReadState?: DetailHotReadState;
};

function getDetailHotReadState(): DetailHotReadState {
  const g = globalThis as GlobalWithDetailHotReadState;
  if (!g.__fundDetailHotReadState) {
    g.__fundDetailHotReadState = {
      latestSnapshotCache: new Map(),
      latestSnapshotInFlight: new Map(),
      historyCache: new Map(),
      historyInFlight: new Map(),
      historyFailureUntil: new Map(),
    };
  }
  return g.__fundDetailHotReadState;
}

function parseDbExecMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toString" in value) {
    try {
      const parsed = Number((value as { toString(): string }).toString());
      return Number.isFinite(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function shouldTrackHistoryFailureCategory(category: string): boolean {
  return (
    category === "pool_checkout_timeout" ||
    category === "query_execution_timeout" ||
    category === "transaction_timeout" ||
    category === "connection_closed" ||
    category === "connect_timeout" ||
    category === "network_unreachable"
  );
}

function historyRowsCoverageDays(rowsDesc: FundHistoryRow[]): number {
  const points = dedupeSessionPricePoints(
    rowsDesc.map((row) => ({ date: row.date, price: row.price }))
  );
  if (points.length < 2) return 0;
  return Math.max(
    0,
    Math.round((points[points.length - 1]!.date.getTime() - points[0]!.date.getTime()) / DAY_MS)
  );
}

function snapshotHistoryIsDenseEnoughForFirstRender(rowsDesc: FundHistoryRow[]): boolean {
  return (
    rowsDesc.length >= DETAIL_PRICE_HISTORY_SNAPSHOT_DENSE_MIN_POINTS &&
    historyRowsCoverageDays(rowsDesc) >= DETAIL_PRICE_HISTORY_SNAPSHOT_DENSE_MIN_COVERAGE_DAYS
  );
}

function setPriceHistoryFailureCooldown(
  state: DetailHotReadState,
  key: string,
  category: string
): void {
  if (!shouldTrackHistoryFailureCategory(category)) return;
  state.historyFailureUntil.set(key, {
    until: Date.now() + DETAIL_PRICE_HISTORY_FAILURE_COOLDOWN_MS,
    category,
    updatedAt: Date.now(),
  });
  trimMapOldestEntries(state.historyFailureUntil, DETAIL_HOT_READ_CACHE_MAX_KEYS);
}

function trimMapOldestEntries<K, V>(map: Map<K, V>, maxSize: number): void {
  while (map.size > maxSize) {
    const first = map.keys().next();
    if (first.done) break;
    map.delete(first.value);
  }
}

function buildPriceHistoryCacheKey(params: { fundId: string; fromDate: Date; toDate: Date; limit: number }): string {
  return `${params.fundId}|${params.fromDate.toISOString()}|${params.toDate.toISOString()}|${params.limit}`;
}

function parsePriceHistoryCacheKey(
  key: string
): { fundId: string; fromIso: string; toIso: string; limit: number } | null {
  const firstSep = key.indexOf("|");
  if (firstSep <= 0) return null;
  const secondSep = key.indexOf("|", firstSep + 1);
  if (secondSep <= firstSep + 1) return null;
  const thirdSep = key.indexOf("|", secondSep + 1);
  if (thirdSep <= secondSep + 1) return null;
  const fundId = key.slice(0, firstSep);
  const fromIso = key.slice(firstSep + 1, secondSep);
  const toIso = key.slice(secondSep + 1, thirdSep);
  const limitRaw = Number(key.slice(thirdSep + 1));
  if (!fundId || !fromIso || !toIso || !Number.isFinite(limitRaw)) return null;
  return { fundId, fromIso, toIso, limit: Math.trunc(limitRaw) };
}

function historyRowsCoverRequestedWindow(rows: FundHistoryRow[], fromDate: Date): boolean {
  if (rows.length === 0) return false;
  const oldest = rows[rows.length - 1];
  if (!oldest) return false;
  const toleranceMs = DETAIL_RETURN_WINDOW_TOLERANCE_DAYS * DAY_MS;
  return normalizeHistorySessionDate(oldest.date).getTime() <= fromDate.getTime() + toleranceMs;
}

function hasSameHistoryWindow(
  parsed: { fundId: string; fromIso: string; toIso: string; limit: number } | null,
  params: { fundId: string; fromDate: Date; toDate: Date; limit: number }
): boolean {
  if (!parsed) return false;
  return (
    parsed.fundId === params.fundId &&
    parsed.fromIso === params.fromDate.toISOString() &&
    parsed.toIso === params.toDate.toISOString()
  );
}

function selectedRangeFromRows(rows: FundHistoryRow[]): { fromIso: string; toIso: string } {
  if (rows.length === 0) return { fromIso: "none", toIso: "none" };
  const descFirst = rows[0];
  const descLast = rows[rows.length - 1];
  const to = descFirst ? normalizeHistorySessionDate(descFirst.date).toISOString() : "none";
  const from = descLast ? normalizeHistorySessionDate(descLast.date).toISOString() : "none";
  return { fromIso: from, toIso: to };
}

type DerivedMetricsRow = {
  return30d: number | null;
  return90d: number | null;
  return180d: number | null;
  return1y: number | null;
  return2y: number | null;
  volatility1y: number | null;
  maxDrawdown1y: number | null;
  annualizedReturn1y: number;
  sharpe1y: number;
  sortino1y: number;
  totalReturn2y: number | null;
  historySessions: number;
};

type MinimalFundRow = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  description: string | null;
  logoUrl: string | null;
  lastPrice: number;
  dailyReturn: number;
  weeklyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  lastUpdatedAt: Date | null;
  updatedAt: Date;
};

type MinimalFundRestRow = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  description: string | null;
  logoUrl: string | null;
  lastPrice: number;
  dailyReturn: number;
  weeklyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  lastUpdatedAt: string | null;
  updatedAt: string | null;
};

type LatestSnapshotCoreRow = {
  date: Date;
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  fundTypeCode: number | null;
  fundTypeName: string | null;
  riskLevel: string;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  alpha: number;
  sparkline: unknown;
  metrics: unknown;
};

type LatestSnapshotSqlRow = {
  date: Date;
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  fundTypeCode: number | null;
  fundTypeName: string | null;
  riskLevel: string;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  alpha: number;
  sparkline: unknown;
  metrics: unknown;
  dbExecMs: number | string | null;
};

type CoreSnapshotSeriesSqlRow = {
  date: Date;
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  fundTypeCode: number | null;
  fundTypeName: string | null;
  riskLevel: string;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  alpha: number;
  sparkline: unknown;
  metrics: unknown;
  dbExecMs: number | string | null;
};

type PriceHistorySessionSqlRow = {
  sessionDate: Date;
  price: number;
  dailyReturn: number;
  portfolioSize: number | null;
  investorCount: number | null;
};

type PriceHistoryBoundsSqlRow = {
  minDate: Date | null;
  maxDate: Date | null;
  totalRows: bigint | number;
  sessionDays: bigint | number;
};

function parseDateOrNow(value: string | null | undefined): Date {
  if (!value) return new Date();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return new Date();
  return new Date(parsed);
}

function buildLatestSnapshotRowFromServing(
  code: string,
  serving: FundDetailCoreServingPayload
): LatestSnapshotCoreRow | null {
  const snapshotDateIso = serving.latestSnapshotDate;
  if (!snapshotDateIso) return null;
  const snapshotDateMs = Date.parse(snapshotDateIso);
  if (!Number.isFinite(snapshotDateMs)) return null;
  const fundId = serving.fund.fundId?.trim();
  if (!fundId) return null;
  const historySparkline = (Array.isArray(serving.chartHistory?.points) ? serving.chartHistory.points : [])
    .slice(-24)
    .map((point) => point.p);
  const sparkline = (historySparkline.length > 0 ? historySparkline : serving.miniPriceSeries.map((point) => point.p))
    .filter((value) => Number.isFinite(value) && value > 0);
  return {
    date: new Date(snapshotDateMs),
    fundId,
    code: serving.fund.code || code,
    name: serving.fund.name || code,
    shortName: serving.fund.shortName ?? null,
    logoUrl: serving.fund.logoUrl ?? null,
    categoryCode: serving.fund.categoryCode ?? null,
    categoryName: serving.fund.categoryName ?? null,
    fundTypeCode: serving.fund.fundTypeCode ?? null,
    fundTypeName: serving.fund.fundTypeName ?? null,
    riskLevel: typeof serving.riskLevel === "string" ? serving.riskLevel : "",
    lastPrice: Number.isFinite(serving.latestPrice) ? serving.latestPrice : 0,
    dailyReturn: Number.isFinite(serving.dailyChangePct) ? serving.dailyChangePct : 0,
    monthlyReturn: Number.isFinite(serving.monthlyReturn) ? serving.monthlyReturn : 0,
    yearlyReturn: Number.isFinite(serving.yearlyReturn) ? serving.yearlyReturn : 0,
    portfolioSize: Number.isFinite(serving.portfolioSummary.current) ? serving.portfolioSummary.current : 0,
    investorCount: Number.isFinite(serving.investorSummary.current)
      ? Math.round(serving.investorSummary.current)
      : 0,
    alpha: Number.isFinite(serving.snapshotAlpha ?? NaN) ? Number(serving.snapshotAlpha) : 0,
    sparkline,
    metrics: serving.snapshotMetrics ?? null,
  };
}

async function loadMinimalFundRowFromSupabaseRest(code: string): Promise<MinimalFundRow | null> {
  if (!hasSupabaseRestConfig()) return null;
  const query = new URLSearchParams({
    select:
      "id,code,name,shortName,description,logoUrl,lastPrice,dailyReturn,weeklyReturn,monthlyReturn,yearlyReturn,portfolioSize,investorCount,lastUpdatedAt,updatedAt",
    code: `eq.${code}`,
    limit: "1",
  });
  const rows = await fetchSupabaseRestJson<MinimalFundRestRow[]>(`Fund?${query.toString()}`, {
    timeoutMs: DETAIL_MINIMAL_FUND_REST_TIMEOUT_MS,
    retries: 0,
    revalidate: 30,
  });
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    shortName: row.shortName ?? null,
    description: row.description ?? null,
    logoUrl: row.logoUrl ?? null,
    lastPrice: Number.isFinite(row.lastPrice) ? Number(row.lastPrice) : 0,
    dailyReturn: Number.isFinite(row.dailyReturn) ? Number(row.dailyReturn) : 0,
    weeklyReturn: Number.isFinite(row.weeklyReturn) ? Number(row.weeklyReturn) : 0,
    monthlyReturn: Number.isFinite(row.monthlyReturn) ? Number(row.monthlyReturn) : 0,
    yearlyReturn: Number.isFinite(row.yearlyReturn) ? Number(row.yearlyReturn) : 0,
    portfolioSize: Number.isFinite(row.portfolioSize) ? Number(row.portfolioSize) : 0,
    investorCount: Number.isFinite(row.investorCount) ? Number(row.investorCount) : 0,
    lastUpdatedAt: row.lastUpdatedAt ? parseDateOrNow(row.lastUpdatedAt) : null,
    updatedAt: parseDateOrNow(row.updatedAt),
  };
}

function toHistoryMetricsFromDerived(row: DerivedMetricsRow): FundMetrics {
  return {
    totalReturn: row.totalReturn2y ?? row.return1y ?? 0,
    annualizedReturn: row.annualizedReturn1y,
    volatility: row.volatility1y ?? 0,
    maxDrawdown: row.maxDrawdown1y ?? 0,
    sharpeRatio: row.sharpe1y,
    sortinoRatio: row.sortino1y,
    calmarRatio: 0,
    winRate: 0,
    avgGain: 0,
    avgLoss: 0,
    dataPoints: row.historySessions,
  };
}

function bestWorstDailyReturn(
  rows: Array<{ dailyReturn: number }>
): { bestPct: number; worstPct: number } | null {
  let best = -Infinity;
  let worst = Infinity;
  for (const r of rows) {
    const v = r.dailyReturn;
    if (!Number.isFinite(v) || v === 0) continue;
    if (v > best) best = v;
    if (v < worst) worst = v;
  }
  if (!Number.isFinite(best) || !Number.isFinite(worst)) return null;
  return { bestPct: best, worstPct: worst };
}

async function measureStep<T>(
  steps: DetailStepDurations,
  name: string,
  task: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await task();
  } finally {
    steps[name] = Date.now() - startedAt;
  }
}

function buildTrendSeries(rows: FundHistoryRow[]): {
  portfolioSize: FundDetailTrendPoint[];
  investorCount: FundDetailTrendPoint[];
} {
  const bySession = new Map<number, { portfolioSize: number | null; investorCount: number | null }>();
  for (const row of rows) {
    const key = normalizeHistorySessionDate(row.date).getTime();
    const current = bySession.get(key) ?? { portfolioSize: null, investorCount: null };
    const portfolioValue = row.portfolioSize;
    if (typeof portfolioValue === "number" && Number.isFinite(portfolioValue) && portfolioValue > 0) {
      current.portfolioSize = portfolioValue;
    }
    const investorValue = row.investorCount;
    if (typeof investorValue === "number" && Number.isFinite(investorValue) && investorValue >= 0) {
      current.investorCount = investorValue;
    }
    bySession.set(key, current);
  }
  const ordered = [...bySession.entries()].sort((a, b) => a[0] - b[0]);
  return {
    portfolioSize: downsampleTimeSeries(
      ordered
      .filter(([, value]) => value.portfolioSize != null)
      .map(([t, value]) => ({ t, v: value.portfolioSize as number })),
      DETAIL_TREND_SERIES_MAX_POINTS
    ),
    investorCount: downsampleTimeSeries(
      ordered
      .filter(([, value]) => value.investorCount != null)
      .map(([t, value]) => ({ t, v: value.investorCount as number })),
      DETAIL_TREND_SERIES_MAX_POINTS
    ),
  };
}

function returnApproxCalendarDays(points: PricePoint[], days: number): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  const cutoff = last.date.getTime() - days * DAY_MS;
  const earliest = points[0]!;
  const toleranceMs = DETAIL_RETURN_WINDOW_TOLERANCE_DAYS * DAY_MS;
  if (earliest.date.getTime() > cutoff + toleranceMs) {
    return null;
  }
  let start: PricePoint | null = null;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i]!;
    if (p.date.getTime() <= cutoff) {
      start = p;
      break;
    }
  }
  if (!start) start = points[0]!;
  if (start.price <= 0 || last.price <= 0) return null;
  return (last.price / start.price - 1) * 100;
}

function reliableHistoryMetrics(points: PricePoint[]): FundMetrics | null {
  if (points.length < DETAIL_MIN_HISTORY_METRICS_POINTS) return null;
  return calculateAllMetrics(points);
}

function bestWorstRollingTradingWindow(points: PricePoint[], span: number): { bestPct: number; worstPct: number } | null {
  if (points.length < span + 1) return null;
  let best = -Infinity;
  let worst = Infinity;
  for (let i = 0; i <= points.length - span - 1; i += 1) {
    const p0 = points[i]!.price;
    const p1 = points[i + span]!.price;
    if (p0 <= 0) continue;
    const r = (p1 / p0 - 1) * 100;
    if (r > best) best = r;
    if (r < worst) worst = r;
  }
  if (!Number.isFinite(best) || !Number.isFinite(worst)) return null;
  return { bestPct: best, worstPct: worst };
}

async function getFundDetailPageDataLegacy(rawCode: string): Promise<FundDetailPageData | null> {
  const normalizedCode = rawCode.trim().toUpperCase();
  if (!normalizedCode) return null;

  const fund = await prisma.fund.findFirst({
    where: { code: normalizedCode },
    select: {
      id: true,
      code: true,
      name: true,
      shortName: true,
      description: true,
      logoUrl: true,
      lastPrice: true,
      dailyReturn: true,
      weeklyReturn: true,
      monthlyReturn: true,
      yearlyReturn: true,
      portfolioSize: true,
      investorCount: true,
      lastUpdatedAt: true,
      updatedAt: true,
      categoryId: true,
      category: { select: { code: true, name: true } },
      fundType: { select: { code: true, name: true } },
    },
  });

  if (!fund) return null;

  const historyFromDate = new Date(Date.now() - DETAIL_HISTORY_LOOKBACK_DAYS * DAY_MS);

  const [historyLoad, latestSnap, similarRows] = await Promise.all([
    loadPriceHistoryByDateDescRawLean({
      fundId: fund.id,
      fromDate: historyFromDate,
      toDate: new Date(),
      limit: DETAIL_HISTORY_FETCH_LIMIT,
    }),
    prisma.fundDailySnapshot.findFirst({
      where: { fundId: fund.id },
      orderBy: { date: "desc" },
      select: { date: true, riskLevel: true, metrics: true, alpha: true },
    }),
    fund.categoryId
      ? prisma.fund.findMany({
          where: {
            categoryId: fund.categoryId,
            id: { not: fund.id },
            isActive: true,
          },
          orderBy: { portfolioSize: "desc" },
          take: FUND_ALTERNATIVES_CANDIDATE_POOL,
          select: {
            id: true,
            code: true,
            name: true,
            shortName: true,
            lastPrice: true,
            dailyReturn: true,
            logoUrl: true,
            portfolioSize: true,
            investorCount: true,
            monthlyReturn: true,
            yearlyReturn: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const historyRows = historyLoad.rows;

  const ascHistory = [...historyRows].reverse() as FundHistoryRow[];
  const points = dedupeSessionPricePoints(ascHistory.map((r) => ({ date: r.date, price: r.price })));
  const priceSeries: FundDetailPricePoint[] = downsampleTimeSeries(points, DETAIL_PRICE_SERIES_MAX_POINTS).map((pt) => ({
    t: pt.date.getTime(),
    p: pt.price,
  }));

  const historyMetrics = reliableHistoryMetrics(points);
  const bestWorstDay =
    ascHistory.length > 0 ? bestWorstDailyReturn(ascHistory.map((r) => ({ dailyReturn: r.dailyReturn }))) : null;

  const snapshotMetrics = latestSnap ? parseFundMetricsJson(latestSnap.metrics) : null;
  const riskFromSnap = latestSnap ? parseRiskLevel(latestSnap.riskLevel) : null;
  const categoryCode = "";
  const riskLevel = riskFromSnap ?? determineRiskLevel(categoryCode, fund.name);

  const ft = fund.fundType;
  const fundTypeResolved = ft
    ? { code: ft.code, name: fundTypeDisplayLabel({ code: ft.code, name: ft.name }) }
    : null;

  const rolling = bestWorstRollingTradingWindow(points, ROLLING_TRADING_DAYS);
  const derivedSummary: FundDetailDerivedSummary = {
    returnApprox1YearPct: returnApproxCalendarDays(points, 365),
    returnApprox2YearPct: returnApproxCalendarDays(points, 730),
    returnApprox3YearPct: returnApproxCalendarDays(points, 1095),
    bestRollingMonthPct: rolling?.bestPct ?? null,
    worstRollingMonthPct: rolling?.worstPct ?? null,
  };

  const benchCode = categoryCode ? getBenchmarkForCategory(categoryCode) : null;
  const modelBenchmark =
    benchCode && categoryCode
      ? { code: benchCode, label: getBenchmarkName(benchCode) }
      : null;

  const snapshotAlpha =
    latestSnap && Number.isFinite(latestSnap.alpha) ? latestSnap.alpha : null;

  const similarCandidates: FundAlternativeCandidate[] = similarRows.map((row) => ({
    code: row.code,
    name: row.name,
    shortName: row.shortName,
    lastPrice: row.lastPrice,
    dailyReturn: row.dailyReturn,
    logoUrl: getFundLogoUrlForUi(row.id, row.code, row.logoUrl, row.name),
    portfolioSize: row.portfolioSize,
    investorCount: row.investorCount,
    monthlyReturn: row.monthlyReturn,
    yearlyReturn: row.yearlyReturn,
  }));

  const similarCategoryPeerDailyReturns = similarCandidates
    .map((c) => c.dailyReturn)
    .filter((x) => Number.isFinite(x));

  const similarFunds: FundDetailSimilarFund[] = buildFundAlternatives(
    {
      portfolioSize: fund.portfolioSize,
      investorCount: fund.investorCount,
      dailyReturn: fund.dailyReturn,
      monthlyReturn: fund.monthlyReturn,
      yearlyReturn: fund.yearlyReturn,
    },
    similarCandidates
  );

  const categoryReturnAverages = await loadCategoryReturnAverages(
    fund.id,
    fund.category?.code ?? null,
    latestSnap?.date ?? null
  );

  const derivedForKiyas = await prisma.fundDerivedMetrics.findUnique({
    where: { fundId: fund.id },
    select: {
      return30d: true,
      return90d: true,
      return180d: true,
      return1y: true,
      return2y: true,
    },
  });
  const anchorForKiyas = latestSnap?.date ?? points[points.length - 1]?.date ?? new Date();
  const kiyasBlock = await buildFundKiyasBlock({
    fundId: fund.id,
    categoryId: fund.categoryId,
    categoryCode: fund.category?.code ?? null,
    fundName: fund.name,
    fundTypeCode: fund.fundType?.code ?? null,
    anchorDate: anchorForKiyas,
    // 3Y türevi henüz tabloda ayrı saklanmıyor; history fallback devreye girer.
    derived: derivedForKiyas ? { ...derivedForKiyas, return3y: null } : null,
    pricePoints: points,
  });
  const trendSeries = DETAIL_RESCUE_MODE
    ? { portfolioSize: [], investorCount: [] }
    : buildTrendSeries(ascHistory);

  return {
    fund: {
      code: fund.code,
      name: fund.name,
      shortName: fund.shortName,
      description: fund.description,
      lastPrice: fund.lastPrice,
      dailyReturn: fund.dailyReturn,
      weeklyReturn: fund.weeklyReturn,
      monthlyReturn: fund.monthlyReturn,
      yearlyReturn: fund.yearlyReturn,
      portfolioSize: fund.portfolioSize,
      investorCount: fund.investorCount,
      category: fund.category,
      fundType: fundTypeResolved,
      logoUrl: getFundLogoUrlForUi(fund.id, fund.code, fund.logoUrl, fund.name),
      lastUpdatedAt: fund.lastUpdatedAt ? fund.lastUpdatedAt.toISOString() : null,
      updatedAt: fund.updatedAt.toISOString(),
      portfolioManagerInferred: null,
    },
    snapshotDate: latestSnap?.date ? latestSnap.date.toISOString() : null,
    snapshotAlpha,
    riskLevel,
    snapshotMetrics,
    priceSeries,
    historyMetrics,
    bestWorstDay,
    modelBenchmark,
    tradingCurrency: "TRY",
    derivedSummary,
    similarFunds,
    similarCategoryPeerDailyReturns,
    categoryReturnAverages,
    kiyasBlock,
    trendSeries,
  };
}

async function buildMinimalDetailPayloadFromFundTable(
  normalizedCode: string,
  steps: DetailStepDurations,
  failedSteps: string[],
  degradedReasons: Set<string>
): Promise<FundDetailPageData | null> {
  let fund: MinimalFundRow | null = null;
  let fundSource: "db" | "supabase_rest" | "none" = "none";
  try {
    fund = await measureStep(steps, "minimal_fund_query", () =>
      withTimeout(
        prisma.fund.findFirst({
          where: { code: normalizedCode },
          select: {
            id: true,
            code: true,
            name: true,
            shortName: true,
            description: true,
            logoUrl: true,
            lastPrice: true,
            dailyReturn: true,
            weeklyReturn: true,
            monthlyReturn: true,
            yearlyReturn: true,
            portfolioSize: true,
            investorCount: true,
            lastUpdatedAt: true,
            updatedAt: true,
          },
        }),
        DETAIL_MINIMAL_FUND_TIMEOUT_MS,
        "minimal_fund_query"
      )
    );
    if (fund) {
      fundSource = "db";
    }
  } catch (error) {
    console.warn("[fund-detail] minimal_fund_query degraded", error);
    failedSteps.push("minimal_fund_query");
    degradedReasons.add("minimal_fund_query_failed");
  }

  if (!fund && DETAIL_MINIMAL_FUND_REST_FALLBACK_ENABLED) {
    try {
      fund = await measureStep(steps, "minimal_fund_rest_query", () => loadMinimalFundRowFromSupabaseRest(normalizedCode));
      if (fund) {
        fundSource = "supabase_rest";
        degradedReasons.add("minimal_fund_rest_fallback");
      } else {
        degradedReasons.add("minimal_fund_rest_empty");
      }
    } catch (error) {
      console.error("[fund-detail] minimal_fund_rest_query failed", error);
      failedSteps.push("minimal_fund_rest_query");
      degradedReasons.add("minimal_fund_rest_query_failed");
    }
  } else if (!fund) {
    steps.minimal_fund_rest_query = 0;
    degradedReasons.add("minimal_fund_rest_disabled");
  }

  if (!fund) return null;

  steps.minimal_price_history_query = 0;
  const seriesPoints = buildApproxPricePointsFromReturns(
    fund.lastUpdatedAt ?? fund.updatedAt,
    fund.lastPrice,
    fund.monthlyReturn,
    fund.yearlyReturn
  );

  const categoryCode = "";
  const benchCode = categoryCode ? getBenchmarkForCategory(categoryCode) : null;
  const modelBenchmark = benchCode ? { code: benchCode, label: getBenchmarkName(benchCode) } : null;
  const rolling = bestWorstRollingTradingWindow(seriesPoints, ROLLING_TRADING_DAYS);
  const derivedSummary: FundDetailDerivedSummary = {
    returnApprox1YearPct: returnApproxCalendarDays(seriesPoints, 365),
    returnApprox2YearPct: returnApproxCalendarDays(seriesPoints, 730),
    returnApprox3YearPct: returnApproxCalendarDays(seriesPoints, 1095),
    bestRollingMonthPct: rolling?.bestPct ?? null,
    worstRollingMonthPct: rolling?.worstPct ?? null,
  };
  const fundTypeResolved = null;
  const trendAnchor = (fund.lastUpdatedAt ?? fund.updatedAt).getTime();
  const investorTrend =
    Number.isFinite(fund.investorCount) && fund.investorCount > 0
      ? [{ t: trendAnchor, v: Math.max(0, Math.round(fund.investorCount)) }]
      : [];
  const portfolioTrend =
    Number.isFinite(fund.portfolioSize) && fund.portfolioSize > 0
      ? [{ t: trendAnchor, v: fund.portfolioSize }]
      : [];

  degradedReasons.add("minimal_fund_payload");
  degradedReasons.add("minimal_series_from_returns");
  if (seriesPoints.length < 2) degradedReasons.add("history_fallback_series_used");
  if (fundSource !== "none") degradedReasons.add(`minimal_fund_source_${fundSource}`);

  return {
    fund: {
      code: fund.code,
      name: fund.name,
      shortName: fund.shortName,
      description: fund.description,
      lastPrice: fund.lastPrice,
      dailyReturn: fund.dailyReturn,
      weeklyReturn: fund.weeklyReturn,
      monthlyReturn: fund.monthlyReturn,
      yearlyReturn: fund.yearlyReturn,
      portfolioSize: fund.portfolioSize,
      investorCount: fund.investorCount,
      category: null,
      fundType: fundTypeResolved,
      logoUrl: getFundLogoUrlForUi(fund.id, fund.code, fund.logoUrl, fund.name),
      lastUpdatedAt: fund.lastUpdatedAt ? fund.lastUpdatedAt.toISOString() : null,
      updatedAt: fund.updatedAt.toISOString(),
      portfolioManagerInferred: null,
    },
    snapshotDate: fund.lastUpdatedAt ? fund.lastUpdatedAt.toISOString() : null,
    snapshotAlpha: null,
    riskLevel: determineRiskLevel(categoryCode, fund.name),
    snapshotMetrics: null,
    priceSeries: downsampleTimeSeries(seriesPoints, DETAIL_PRICE_SERIES_MAX_POINTS).map((point) => ({
      t: point.date.getTime(),
      p: point.price,
    })),
    historyMetrics: reliableHistoryMetrics(seriesPoints),
    bestWorstDay: null,
    modelBenchmark,
    tradingCurrency: "TRY",
    derivedSummary,
    similarFunds: [],
    similarCategoryPeerDailyReturns: [],
    categoryReturnAverages: null,
    kiyasBlock: null,
    trendSeries: { portfolioSize: portfolioTrend, investorCount: investorTrend },
  };
}

function buildEmergencyDetailFallbackPayload(normalizedCode: string): FundDetailPageData {
  return {
    fund: {
      code: normalizedCode,
      name: normalizedCode,
      shortName: null,
      description: null,
      lastPrice: 0,
      dailyReturn: 0,
      weeklyReturn: 0,
      monthlyReturn: 0,
      yearlyReturn: 0,
      portfolioSize: 0,
      investorCount: 0,
      category: null,
      fundType: null,
      logoUrl: null,
      lastUpdatedAt: null,
      updatedAt: new Date().toISOString(),
      portfolioManagerInferred: null,
    },
    snapshotDate: null,
    snapshotAlpha: null,
    riskLevel: null,
    snapshotMetrics: null,
    priceSeries: [],
    historyMetrics: null,
    bestWorstDay: null,
    modelBenchmark: null,
    tradingCurrency: "TRY",
    derivedSummary: {
      returnApprox1YearPct: null,
      returnApprox2YearPct: null,
      returnApprox3YearPct: null,
      bestRollingMonthPct: null,
      worstRollingMonthPct: null,
    },
    similarFunds: [],
    similarCategoryPeerDailyReturns: [],
    categoryReturnAverages: null,
    kiyasBlock: null,
    trendSeries: { portfolioSize: [], investorCount: [] },
  };
}

async function loadLatestSnapshotLean(code: string): Promise<LatestSnapshotLeanResult> {
  const rows = await prisma.$queryRaw<LatestSnapshotSqlRow[]>`
    SELECT
      "date",
      "fundId",
      "code",
      "name",
      "shortName",
      "logoUrl",
      "categoryCode",
      "categoryName",
      "fundTypeCode",
      "fundTypeName",
      "riskLevel",
      "lastPrice",
      "dailyReturn",
      "monthlyReturn",
      "yearlyReturn",
      "portfolioSize",
      "investorCount",
      "alpha",
      "sparkline",
      "metrics",
      (EXTRACT(EPOCH FROM (clock_timestamp() - statement_timestamp())) * 1000)::double precision AS "dbExecMs"
    FROM "FundDailySnapshot"
    WHERE "code" = ${code}
    ORDER BY "date" DESC
    LIMIT 1
  `;
  const first = rows[0];
  if (!first) return { row: null, dbExecMs: null };
  const dbExecMs = parseDbExecMs(first.dbExecMs);
  const row: LatestSnapshotCoreRow = {
    date: first.date,
    fundId: first.fundId,
    code: first.code,
    name: first.name,
    shortName: first.shortName,
    logoUrl: first.logoUrl,
    categoryCode: first.categoryCode,
    categoryName: first.categoryName,
    fundTypeCode: first.fundTypeCode,
    fundTypeName: first.fundTypeName,
    riskLevel: first.riskLevel,
    lastPrice: first.lastPrice,
    dailyReturn: first.dailyReturn,
    monthlyReturn: first.monthlyReturn,
    yearlyReturn: first.yearlyReturn,
    portfolioSize: first.portfolioSize,
    investorCount: first.investorCount,
    alpha: first.alpha,
    sparkline: first.sparkline,
    metrics: first.metrics,
  };
  return { row, dbExecMs };
}

async function loadLatestSnapshotLeanCached(code: string): Promise<
  LatestSnapshotLeanResult & { cacheHit: boolean; deduped: boolean; dbQueryCount: 0 | 1 }
> {
  const state = getDetailHotReadState();
  const now = Date.now();
  const cached = state.latestSnapshotCache.get(code);
  if (cached && now - cached.updatedAt <= DETAIL_LATEST_SNAPSHOT_CACHE_TTL_MS) {
    return { ...cached.value, cacheHit: true, deduped: false, dbQueryCount: 0 };
  }
  const inflight = state.latestSnapshotInFlight.get(code);
  if (inflight) {
    const value = await inflight;
    return { ...value, cacheHit: false, deduped: true, dbQueryCount: 0 };
  }

  const promise = loadLatestSnapshotLean(code);
  state.latestSnapshotInFlight.set(code, promise);
  try {
    const value = await promise;
    state.latestSnapshotCache.set(code, { updatedAt: Date.now(), value });
    trimMapOldestEntries(state.latestSnapshotCache, DETAIL_HOT_READ_CACHE_MAX_KEYS);
    return { ...value, cacheHit: false, deduped: false, dbQueryCount: 1 };
  } finally {
    state.latestSnapshotInFlight.delete(code);
  }
}

async function loadCoreSnapshotSeriesLean(
  code: string,
  limit: number
): Promise<{ rows: LatestSnapshotCoreRow[]; dbExecMs: number | null }> {
  const rows = await prisma.$queryRaw<CoreSnapshotSeriesSqlRow[]>`
    SELECT
      "date",
      "fundId",
      "code",
      "name",
      "shortName",
      "logoUrl",
      "categoryCode",
      "categoryName",
      "fundTypeCode",
      "fundTypeName",
      "riskLevel",
      "lastPrice",
      "dailyReturn",
      "monthlyReturn",
      "yearlyReturn",
      "portfolioSize",
      "investorCount",
      "alpha",
      "sparkline",
      "metrics",
      (EXTRACT(EPOCH FROM (clock_timestamp() - statement_timestamp())) * 1000)::double precision AS "dbExecMs"
    FROM "FundDailySnapshot"
    WHERE "code" = ${code}
    ORDER BY "date" DESC
    LIMIT ${limit}
  `;
  if (rows.length === 0) return { rows: [], dbExecMs: null };
  const dbExecMs = parseDbExecMs(rows[0]?.dbExecMs ?? null);
  return {
    rows: rows.map((row) => ({
      date: row.date,
      fundId: row.fundId,
      code: row.code,
      name: row.name,
      shortName: row.shortName,
      logoUrl: row.logoUrl,
      categoryCode: row.categoryCode,
      categoryName: row.categoryName,
      fundTypeCode: row.fundTypeCode,
      fundTypeName: row.fundTypeName,
      riskLevel: row.riskLevel,
      lastPrice: row.lastPrice,
      dailyReturn: row.dailyReturn,
      monthlyReturn: row.monthlyReturn,
      yearlyReturn: row.yearlyReturn,
      portfolioSize: row.portfolioSize,
      investorCount: row.investorCount,
      alpha: row.alpha,
      sparkline: row.sparkline,
      metrics: row.metrics,
    })),
    dbExecMs,
  };
}

async function runBoundedPriceHistoryQuery<T>(
  task: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL statement_timeout = ${Math.max(1_000, DETAIL_PRICE_HISTORY_DB_STATEMENT_TIMEOUT_MS)}`
      );
      return task(tx);
    },
    {
      maxWait: DETAIL_PRICE_HISTORY_DB_MAX_WAIT_MS,
      timeout: DETAIL_PRICE_HISTORY_DB_STATEMENT_TIMEOUT_MS + 1_500,
    }
  );
}

async function loadPriceHistoryBySessionDistinctLean(params: {
  fundId: string;
  fromDate: Date;
  toDate: Date;
  limit: number;
}): Promise<{
  rows: FundHistoryRow[];
  dbExecMs: number | null;
  decodeMs: number;
  rawRows: number;
  queryCount: 1;
  queryPlan: "full_distinct";
}> {
  const queryStartedAt = Date.now();
  const rows = await runBoundedPriceHistoryQuery((tx) =>
    tx.$queryRaw<PriceHistorySessionSqlRow[]>`
      WITH sessions AS (
        SELECT DISTINCT ON (date_trunc('day', "date" + interval '3 hour'))
          date_trunc('day', "date" + interval '3 hour') AS "sessionDate",
          "price",
          "dailyReturn",
          "portfolioSize",
          "investorCount",
          "date"
        FROM "FundPriceHistory"
        WHERE
          "fundId" = ${params.fundId}
          AND "date" >= ${params.fromDate}
          AND "date" <= ${params.toDate}
        ORDER BY date_trunc('day', "date" + interval '3 hour') DESC, "date" DESC
        LIMIT ${params.limit}
      )
      SELECT
        "sessionDate",
        "price",
        "dailyReturn",
        "portfolioSize",
        "investorCount"
      FROM sessions
      ORDER BY "sessionDate" DESC
    `
  );
  const dbExecMs = Math.max(0, Date.now() - queryStartedAt);

  if (rows.length === 0) {
    return { rows: [], dbExecMs: null, decodeMs: 0, rawRows: 0, queryCount: 1, queryPlan: "full_distinct" };
  }

  const decodeStartedAt = Date.now();
  const mappedRows: FundHistoryRow[] = [];
  for (const row of rows) {
    if (!(Number.isFinite(row.price) && row.price > 0)) continue;
    mappedRows.push({
      date: row.sessionDate,
      price: row.price,
      dailyReturn: row.dailyReturn,
      portfolioSize: row.portfolioSize,
      investorCount: row.investorCount,
    });
  }
  const decodeMs = Date.now() - decodeStartedAt;

  return {
    rows: mappedRows,
    dbExecMs,
    decodeMs,
    rawRows: rows.length,
    queryCount: 1,
    queryPlan: "full_distinct",
  };
}

type PriceHistoryRawSqlRow = {
  date: Date;
  price: number;
  dailyReturn: number;
  portfolioSize: number | null;
  investorCount: number | null;
};

type SupabaseSnapshotHistoryRow = {
  date: string;
  lastPrice: number | null;
  dailyReturn: number | null;
  portfolioSize: number | null;
  investorCount: number | null;
};

async function loadPriceHistoryByDateDescRawLean(params: {
  fundId: string;
  fromDate: Date;
  toDate: Date;
  limit: number;
}): Promise<{
  rows: FundHistoryRow[];
  dbExecMs: number | null;
  decodeMs: number;
  rawRows: number;
  queryCount: 1 | 2;
  queryPlan: "raw_desc_js_dedupe" | "raw_desc_js_dedupe_full_fallback";
}> {
  const queryStartedAt = Date.now();
  const rawRows = await runBoundedPriceHistoryQuery((tx) =>
    tx.$queryRaw<PriceHistoryRawSqlRow[]>`
      SELECT
        "date",
        "price",
        "dailyReturn",
        "portfolioSize",
        "investorCount"
      FROM "FundPriceHistory"
      WHERE
        "fundId" = ${params.fundId}
        AND "date" >= ${params.fromDate}
        AND "date" <= ${params.toDate}
      ORDER BY "date" DESC
      LIMIT ${params.limit}
    `
  );
  const dbExecMs = Math.max(0, Date.now() - queryStartedAt);

  if (rawRows.length === 0) {
    return {
      rows: [],
      dbExecMs: null,
      decodeMs: 0,
      rawRows: 0,
      queryCount: 1,
      queryPlan: "raw_desc_js_dedupe",
    };
  }

  const decodeStartedAt = Date.now();
  const sessions = new Map<number, FundHistoryRow>();
  for (const row of rawRows) {
    if (!(Number.isFinite(row.price) && row.price > 0)) continue;
    const sessionDate = normalizeHistorySessionDate(row.date);
    const sessionTs = sessionDate.getTime();
    if (sessions.has(sessionTs)) continue;
    sessions.set(sessionTs, {
      date: sessionDate,
      price: row.price,
      dailyReturn: row.dailyReturn,
      portfolioSize: row.portfolioSize,
      investorCount: row.investorCount,
    });
  }
  const dedupedRows = [...sessions.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
  const decodeMs = Date.now() - decodeStartedAt;

  const reachedRawLimit = rawRows.length >= params.limit;
  const coversRequestedWindow = historyRowsCoverRequestedWindow(dedupedRows, params.fromDate);
  if (DETAIL_PRICE_HISTORY_DISTINCT_FALLBACK && reachedRawLimit && !coversRequestedWindow) {
    const fallback = await loadPriceHistoryBySessionDistinctLean(params);
    return {
      rows: fallback.rows,
      dbExecMs: fallback.dbExecMs,
      decodeMs: decodeMs + fallback.decodeMs,
      rawRows: rawRows.length + fallback.rawRows,
      queryCount: 2,
      queryPlan: "raw_desc_js_dedupe_full_fallback",
    };
  }

  return {
    rows: dedupedRows,
    dbExecMs,
    decodeMs,
    rawRows: rawRows.length,
    queryCount: 1,
    queryPlan: "raw_desc_js_dedupe",
  };
}

async function loadPriceHistoryFromSnapshotLean(params: {
  fundId: string;
  fromDate: Date;
  toDate: Date;
  limit: number;
}): Promise<FundHistoryRow[]> {
  const rows = await prisma.fundDailySnapshot.findMany({
    where: {
      fundId: params.fundId,
      date: {
        gte: params.fromDate,
        lte: params.toDate,
      },
    },
    orderBy: { date: "desc" },
    take: params.limit,
    select: {
      date: true,
      lastPrice: true,
      dailyReturn: true,
      portfolioSize: true,
      investorCount: true,
    },
  });
  return rows
    .map((row) => ({
      date: row.date,
      price: row.lastPrice,
      dailyReturn: row.dailyReturn,
      portfolioSize: row.portfolioSize,
      investorCount: row.investorCount,
    }))
    .filter((row) => Number.isFinite(row.price) && row.price > 0);
}

async function loadPriceHistoryFromSnapshotRest(params: {
  fundId: string;
  fromDate: Date;
  toDate: Date;
  limit: number;
}): Promise<FundHistoryRow[]> {
  if (!DETAIL_PRICE_HISTORY_REST_FALLBACK_ENABLED || !hasSupabaseRestConfig()) return [];
  const query = new URLSearchParams();
  query.set("select", "date,lastPrice,dailyReturn,portfolioSize,investorCount");
  query.set("fundId", `eq.${params.fundId}`);
  query.append("date", `gte.${params.fromDate.toISOString()}`);
  query.append("date", `lte.${params.toDate.toISOString()}`);
  query.set("order", "date.desc");
  query.set("limit", String(params.limit));
  const rows = await fetchSupabaseRestJson<SupabaseSnapshotHistoryRow[]>(
    `FundDailySnapshot?${query.toString()}`,
    {
      revalidate: 60,
      timeoutMs: DETAIL_PRICE_HISTORY_REST_TIMEOUT_MS,
      retries: 0,
    }
  );
  return rows
    .map((row) => ({
      date: new Date(row.date),
      price: typeof row.lastPrice === "number" ? row.lastPrice : Number(row.lastPrice),
      dailyReturn: typeof row.dailyReturn === "number" ? row.dailyReturn : Number(row.dailyReturn),
      portfolioSize:
        typeof row.portfolioSize === "number"
          ? row.portfolioSize
          : row.portfolioSize != null
            ? Number(row.portfolioSize)
            : null,
      investorCount:
        typeof row.investorCount === "number"
          ? row.investorCount
          : row.investorCount != null
            ? Number(row.investorCount)
            : null,
    }))
    .filter((row) => Number.isFinite(row.price) && row.price > 0);
}

async function loadPriceHistoryBySessionLeanCached(params: {
  fundId: string;
  fromDate: Date;
  toDate: Date;
  limit: number;
}): Promise<
  HistoryQueryResult & {
    cacheHit: boolean;
    deduped: boolean;
    limitCompatibleCacheHit: boolean;
    limitCompatibleInFlightHit: boolean;
    cooldownActive: boolean;
    failureCategory: string | null;
    dbQueryCount: 0 | 1 | 2;
  }
> {
  const state = getDetailHotReadState();
  const key = buildPriceHistoryCacheKey(params);
  const now = Date.now();
  const cached = state.historyCache.get(key);
  if (cached && now - cached.updatedAt <= DETAIL_HISTORY_CACHE_TTL_MS) {
    return {
      ...cached.value,
      cacheHit: true,
      deduped: false,
	      limitCompatibleCacheHit: false,
	      limitCompatibleInFlightHit: false,
	      cooldownActive: false,
	      failureCategory: cached.value.fallbackFailureCategory ?? null,
	      dbQueryCount: 0,
	    };
	  }

  const failureWindow = state.historyFailureUntil.get(key);
  if (failureWindow && now < failureWindow.until) {
    if (cached && now - cached.updatedAt <= DETAIL_HISTORY_STALE_ON_FAILURE_TTL_MS) {
      return {
        ...cached.value,
        cacheHit: true,
        deduped: false,
	      limitCompatibleCacheHit: false,
	      limitCompatibleInFlightHit: false,
	      cooldownActive: true,
	      failureCategory: cached.value.fallbackFailureCategory ?? failureWindow.category,
	      dbQueryCount: 0,
	    };
	  }
	  if (DETAIL_PRICE_HISTORY_SNAPSHOT_FASTPATH) {
	    try {
	      const snapshotRows = await loadPriceHistoryFromSnapshotLean(params);
	      if (snapshotRows.length >= 2) {
	        const selectedRange = selectedRangeFromRows(snapshotRows);
	        const fallbackValue: HistoryQueryResult = {
	          rows: snapshotRows,
	          selectedFromIso: selectedRange.fromIso,
	          selectedToIso: selectedRange.toIso,
	          source: "snapshot",
	          dbExecMs: null,
	          decodeMs: 0,
	          rawRows: snapshotRows.length,
	          queryCount: 1,
	          queryPlan: "snapshot_fastpath_cooldown",
	          columns: DETAIL_PRICE_HISTORY_COLUMNS,
	          fallbackFailureCategory: failureWindow.category,
	          fallbackReason: "live_history_cooldown_snapshot_fastpath",
	        };
	        state.historyCache.set(key, { updatedAt: Date.now(), value: fallbackValue });
	        trimMapOldestEntries(state.historyCache, DETAIL_HOT_READ_CACHE_MAX_KEYS);
	        return {
	          ...fallbackValue,
	          cacheHit: false,
	          deduped: false,
	          limitCompatibleCacheHit: false,
	          limitCompatibleInFlightHit: false,
	          cooldownActive: true,
	          failureCategory: failureWindow.category,
	          dbQueryCount: 1,
	        };
	      }
	    } catch {
	      // Cooldown exists because the live path is already unhealthy; keep this fallback best-effort.
	    }
	  }
	  return {
	    rows: [],
      selectedFromIso: "none",
      selectedToIso: "none",
      source: "history",
      dbExecMs: null,
      decodeMs: 0,
      rawRows: 0,
      queryCount: 1,
      queryPlan: "raw_desc_js_dedupe",
      columns: DETAIL_PRICE_HISTORY_COLUMNS,
      cacheHit: false,
      deduped: false,
      limitCompatibleCacheHit: false,
      limitCompatibleInFlightHit: false,
      cooldownActive: true,
      failureCategory: failureWindow.category,
      dbQueryCount: 0,
    };
  }

  if (!cached) {
    let compatible: { updatedAt: number; value: HistoryQueryResult } | null = null;
    for (const [candidateKey, candidate] of state.historyCache.entries()) {
      if (now - candidate.updatedAt > DETAIL_HISTORY_CACHE_TTL_MS) continue;
      const parsed = parsePriceHistoryCacheKey(candidateKey);
      if (!hasSameHistoryWindow(parsed, params)) continue;
      if (!historyRowsCoverRequestedWindow(candidate.value.rows, params.fromDate)) continue;
      if (!compatible || candidate.value.rows.length > compatible.value.rows.length) {
        compatible = candidate;
      }
    }
    if (compatible) {
      return {
        ...compatible.value,
        cacheHit: true,
        deduped: false,
	      limitCompatibleCacheHit: true,
	      limitCompatibleInFlightHit: false,
	      cooldownActive: false,
	      failureCategory: compatible.value.fallbackFailureCategory ?? null,
	      dbQueryCount: 0,
	    };
	  }
  }

  const inflight = state.historyInFlight.get(key);
  if (inflight) {
    const value = await inflight;
    return {
      ...value,
      cacheHit: false,
      deduped: true,
	      limitCompatibleCacheHit: false,
	      limitCompatibleInFlightHit: false,
	      cooldownActive: false,
	      failureCategory: value.fallbackFailureCategory ?? null,
	      dbQueryCount: 0,
	    };
	  }

  let compatibleInFlight: Promise<HistoryQueryResult> | null = null;
  for (const [candidateKey, candidatePromise] of state.historyInFlight.entries()) {
    if (candidateKey === key) continue;
    const parsed = parsePriceHistoryCacheKey(candidateKey);
    if (!hasSameHistoryWindow(parsed, params)) continue;
    if (!compatibleInFlight) compatibleInFlight = candidatePromise;
  }
  if (compatibleInFlight) {
    try {
      const value = await compatibleInFlight;
      if (historyRowsCoverRequestedWindow(value.rows, params.fromDate)) {
        return {
          ...value,
          cacheHit: false,
          deduped: true,
	          limitCompatibleCacheHit: false,
	          limitCompatibleInFlightHit: true,
	          cooldownActive: false,
	          failureCategory: value.fallbackFailureCategory ?? null,
	          dbQueryCount: 0,
	        };
	      }
    } catch {
      // Ignore compatible in-flight failures and continue with direct query.
    }
  }

  const promise = (async (): Promise<HistoryQueryResult> => {
    let source: "snapshot" | "history" = "history";
    let rows: FundHistoryRow[] = [];
    let snapshotRowsForFallback: FundHistoryRow[] = [];
    let dbExecMs: number | null = null;
    let decodeMs = 0;
    let rawRows = 0;
    let queryCount: 1 | 2 = 1;
    let queryPlan: HistoryQueryResult["queryPlan"] = "full_distinct";
    if (DETAIL_PRICE_HISTORY_SNAPSHOT_FASTPATH) {
      source = "snapshot";
      rows = await loadPriceHistoryFromSnapshotLean(params);
      snapshotRowsForFallback = rows;
      rawRows = rows.length;
      queryPlan = "snapshot_fastpath";
      const snapshotStrongEnough = snapshotHistoryIsDenseEnoughForFirstRender(rows);
      const snapshotOldest = rows[rows.length - 1]?.date ?? null;
      const snapshotCoversRequestedWindow =
        rows.length >= 2 &&
        snapshotOldest instanceof Date &&
        snapshotOldest.getTime() <= params.fromDate.getTime() + DETAIL_RETURN_WINDOW_TOLERANCE_DAYS * DAY_MS;
      if (
        DETAIL_PRICE_HISTORY_LIVE_FALLBACK_ENABLED &&
        !snapshotStrongEnough &&
        !snapshotCoversRequestedWindow
      ) {
        let historyRead: Awaited<ReturnType<typeof loadPriceHistoryByDateDescRawLean>>;
        try {
          historyRead = await loadPriceHistoryByDateDescRawLean(params);
        } catch (historyError) {
          const classified = classifyDatabaseError(historyError);
          setPriceHistoryFailureCooldown(state, key, classified.category);
          if (snapshotRowsForFallback.length >= 2) {
            const selectedRange = selectedRangeFromRows(snapshotRowsForFallback);
            return {
              rows: snapshotRowsForFallback,
              selectedFromIso: selectedRange.fromIso,
              selectedToIso: selectedRange.toIso,
              source: "snapshot",
              dbExecMs: null,
              decodeMs,
              rawRows: snapshotRowsForFallback.length,
              queryCount: 1,
              queryPlan: "snapshot_fastpath_after_live_failure",
              columns: DETAIL_PRICE_HISTORY_COLUMNS,
              fallbackFailureCategory: classified.category,
              fallbackReason: "live_history_failed_snapshot_fastpath_retained",
              liveAttempted: true,
            };
          }
          throw historyError;
        }
        rows = historyRead.rows;
        dbExecMs = historyRead.dbExecMs;
        decodeMs = historyRead.decodeMs;
        rawRows = historyRead.rawRows;
        queryCount = 2;
        queryPlan = historyRead.queryPlan;
        source = "history";
      } else {
        queryPlan = "snapshot_fastpath";
      }
    } else {
      const historyRead = await loadPriceHistoryByDateDescRawLean(params);
      rows = historyRead.rows;
      dbExecMs = historyRead.dbExecMs;
      decodeMs = historyRead.decodeMs;
      rawRows = historyRead.rawRows;
      queryCount = historyRead.queryCount;
      queryPlan = historyRead.queryPlan;
      source = "history";
    }
    const selectedRange = selectedRangeFromRows(rows);
    return {
      rows,
      selectedFromIso: selectedRange.fromIso,
      selectedToIso: selectedRange.toIso,
      source,
      dbExecMs,
      decodeMs,
      rawRows,
      queryCount,
      queryPlan,
      columns: DETAIL_PRICE_HISTORY_COLUMNS,
      liveAttempted: source === "history",
    };
  })();
  state.historyInFlight.set(key, promise);
  try {
    const value = await promise;
    if (!value.fallbackFailureCategory) {
      state.historyFailureUntil.delete(key);
    }
    state.historyCache.set(key, { updatedAt: Date.now(), value });
    trimMapOldestEntries(state.historyCache, DETAIL_HOT_READ_CACHE_MAX_KEYS);
    return {
      ...value,
      cacheHit: false,
      deduped: false,
      limitCompatibleCacheHit: false,
      limitCompatibleInFlightHit: false,
      cooldownActive: false,
      failureCategory: value.fallbackFailureCategory ?? null,
      dbQueryCount: value.queryCount,
    };
  } catch (error) {
    const classified = classifyDatabaseError(error);
    if (DETAIL_PRICE_HISTORY_REST_FALLBACK_ENABLED && hasSupabaseRestConfig()) {
      try {
        const restRows = await loadPriceHistoryFromSnapshotRest(params);
        if (restRows.length >= 2) {
          const selectedRange = selectedRangeFromRows(restRows);
          const fallbackValue: HistoryQueryResult = {
            rows: restRows,
            selectedFromIso: selectedRange.fromIso,
            selectedToIso: selectedRange.toIso,
            source: "snapshot",
            dbExecMs: null,
            decodeMs: 0,
            rawRows: restRows.length,
            queryCount: 1,
            queryPlan: "snapshot_rest_fallback",
            columns: "date,lastPrice,dailyReturn,portfolioSize,investorCount",
            fallbackFailureCategory: classified.category,
            fallbackReason: "live_history_failed_rest_snapshot_fallback",
            liveAttempted: true,
          };
          setPriceHistoryFailureCooldown(state, key, classified.category);
          state.historyCache.set(key, { updatedAt: Date.now(), value: fallbackValue });
          trimMapOldestEntries(state.historyCache, DETAIL_HOT_READ_CACHE_MAX_KEYS);
          return {
            ...fallbackValue,
            cacheHit: false,
            deduped: false,
            limitCompatibleCacheHit: false,
            limitCompatibleInFlightHit: false,
            cooldownActive: false,
            failureCategory: classified.category,
            dbQueryCount: 0,
          };
        }
      } catch (restError) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[fund-detail] price_history_rest_fallback failed", restError);
        }
      }
    }
    setPriceHistoryFailureCooldown(state, key, classified.category);
    throw error;
  } finally {
    state.historyInFlight.delete(key);
  }
}

async function loadPriceHistoryBounds(fundId: string): Promise<{
  minDate: Date | null;
  maxDate: Date | null;
  totalRows: number;
  sessionDays: number;
}> {
  const [row] = await prisma.$queryRaw<PriceHistoryBoundsSqlRow[]>`
    SELECT
      MIN("date") AS "minDate",
      MAX("date") AS "maxDate",
      COUNT(*)::bigint AS "totalRows",
      COUNT(DISTINCT date_trunc('day', "date" + interval '3 hour'))::bigint AS "sessionDays"
    FROM "FundPriceHistory"
    WHERE "fundId" = ${fundId}
  `;
  const toNumber = (value: bigint | number | null | undefined): number => {
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "number") return value;
    return 0;
  };
  return {
    minDate: row?.minDate ?? null,
    maxDate: row?.maxDate ?? null,
    totalRows: toNumber(row?.totalRows),
    sessionDays: toNumber(row?.sessionDays),
  };
}

function firstPositiveFinite(values: number[]): number | null {
  for (const value of values) {
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function extractCoreSeriesSource(
  payload: FundDetailPageData
): "history" | "snapshot_fallback" | "approx" | "serving" | "unknown" {
  const reasons = payload.degraded?.reasons ?? [];
  if (reasons.includes("core_price_series_source_history")) return "history";
  if (reasons.includes("core_price_series_source_snapshot_fallback")) return "snapshot_fallback";
  if (reasons.includes("core_price_series_source_approx")) return "approx";
  if (reasons.includes("core_price_series_source_serving")) return "serving";
  return "unknown";
}

function shouldTryPhase1HistoryUpgrade(payload: FundDetailPageData): boolean {
  if (!DETAIL_PHASE1_HISTORY_UPGRADE_ENABLED) return false;
  if (payload.priceSeries.length >= DETAIL_PHASE1_HISTORY_UPGRADE_MIN_POINTS) return false;
  const source = extractCoreSeriesSource(payload);
  return source === "snapshot_fallback" || source === "approx" || source === "serving" || source === "unknown";
}

function coreSeriesDateRange(payload: FundDetailPageData): {
  minIso: string;
  maxIso: string;
  pointCount: number;
} {
  const first = payload.priceSeries[0];
  const last = payload.priceSeries[payload.priceSeries.length - 1];
  return {
    minIso: first ? new Date(first.t).toISOString() : "none",
    maxIso: last ? new Date(last.t).toISOString() : "none",
    pointCount: payload.priceSeries.length,
  };
}

function buildCorePayloadFromSnapshotRows(
  normalizedCode: string,
  snapshotRowsDesc: LatestSnapshotCoreRow[],
  steps: DetailStepDurations,
  degradedReasons: Set<string>,
  failedSteps: string[],
  options?: {
    historyRowsOverride?: FundHistoryRow[] | null;
    forcedSeriesSource?: "history" | "snapshot_fallback" | "approx";
  }
): FundDetailPageData | null {
  const latest = snapshotRowsDesc[0];
  if (!latest) return null;

  const fundTypeResolved =
    latest.fundTypeCode != null && latest.fundTypeName
      ? {
          code: latest.fundTypeCode,
          name: fundTypeDisplayLabel({
            code: latest.fundTypeCode,
            name: latest.fundTypeName,
          }),
        }
      : null;

  const coreSeriesBuildStartedAt = Date.now();
  const snapshotRowsAsc = [...snapshotRowsDesc].reverse();
  const snapshotHistoryRows: FundHistoryRow[] = snapshotRowsAsc.map((row) => ({
    date: row.date,
    price: row.lastPrice,
    dailyReturn: row.dailyReturn,
    portfolioSize: row.portfolioSize,
    investorCount: row.investorCount,
  }));
  const sourceRows =
    options?.historyRowsOverride && options.historyRowsOverride.length > 0
      ? options.historyRowsOverride
      : snapshotHistoryRows;
  const historyPoints = dedupeSessionPricePoints(
    sourceRows.map((row) => ({ date: row.date, price: row.price }))
  );
  const sparklinePoints =
    historyPoints.length >= 2 ? [] : buildSparklinePricePoints(latest.date, latest.sparkline);
  const approxPoints =
    historyPoints.length >= 2 || sparklinePoints.length >= 2
      ? []
      : buildApproxPricePointsFromReturns(
          latest.date,
          latest.lastPrice,
          latest.monthlyReturn,
          latest.yearlyReturn
        );
  const points =
    historyPoints.length >= 2
      ? historyPoints
      : sparklinePoints.length >= 2
        ? sparklinePoints
        : approxPoints;
  const performanceSeriesSource: "history" | "snapshot_fallback" | "approx" = options?.forcedSeriesSource
    ? options.forcedSeriesSource
    : options?.historyRowsOverride && options.historyRowsOverride.length >= 2
      ? "history"
      : historyPoints.length >= 2 || sparklinePoints.length >= 2
        ? "snapshot_fallback"
        : "approx";
  steps.minimal_history_fallback_series_build_ms = Date.now() - coreSeriesBuildStartedAt;

  const priceSeries: FundDetailPricePoint[] = downsampleTimeSeries(points, DETAIL_PRICE_SERIES_MAX_POINTS).map((point) => ({
    t: point.date.getTime(),
    p: point.price,
  }));
  const trendSeriesRaw = buildTrendSeries(sourceRows);
  const trendSeries = {
    investorCount: downsampleTimeSeries(
      normalizeTrendSeriesPoints(trendSeriesRaw.investorCount, "investor"),
      DETAIL_TREND_SERIES_MAX_POINTS
    ),
    portfolioSize: downsampleTimeSeries(
      normalizeTrendSeriesPoints(trendSeriesRaw.portfolioSize, "portfolio"),
      DETAIL_TREND_SERIES_MAX_POINTS
    ),
  };

  const investorSummaryStartedAt = Date.now();
  const investorCurrentCandidates = snapshotRowsDesc.map((row) => row.investorCount);
  const investorCurrent = firstPositiveFinite(investorCurrentCandidates) ?? Math.max(0, latest.investorCount);
  const investorTrendAvailable = trendSeries.investorCount.length >= 2;
  steps.investor_summary_build_ms = Date.now() - investorSummaryStartedAt;

  const portfolioSummaryStartedAt = Date.now();
  const portfolioCurrentCandidates = snapshotRowsDesc.map((row) => row.portfolioSize);
  const portfolioCurrent = firstPositiveFinite(portfolioCurrentCandidates) ?? Math.max(0, latest.portfolioSize);
  const portfolioTrendAvailable = trendSeries.portfolioSize.length >= 2;
  steps.portfolio_summary_build_ms = Date.now() - portfolioSummaryStartedAt;

  const latestPrice = firstPositiveFinite(snapshotRowsDesc.map((row) => row.lastPrice)) ?? 0;
  const snapshotMetrics = parseFundMetricsJson(latest.metrics);
  const riskLevel = parseRiskLevel(latest.riskLevel) ?? determineRiskLevel(latest.categoryCode ?? "", latest.name);
  const rolling = bestWorstRollingTradingWindow(points, ROLLING_TRADING_DAYS);
  const derivedSummary: FundDetailDerivedSummary = {
    returnApprox1YearPct: returnApproxCalendarDays(points, 365),
    returnApprox2YearPct: returnApproxCalendarDays(points, 730),
    returnApprox3YearPct: returnApproxCalendarDays(points, 1095),
    bestRollingMonthPct: rolling?.bestPct ?? null,
    worstRollingMonthPct: rolling?.worstPct ?? null,
  };
  const benchCode = latest.categoryCode ? getBenchmarkForCategory(latest.categoryCode) : null;
  const modelBenchmark = benchCode ? { code: benchCode, label: getBenchmarkName(benchCode) } : null;
  const historyMetrics = reliableHistoryMetrics(points);
  const bestWorstDay =
    sourceRows.length > 0 ? bestWorstDailyReturn(sourceRows.map((row) => ({ dailyReturn: row.dailyReturn }))) : null;

  const payload: FundDetailPageData = {
    fund: {
      code: latest.code || normalizedCode,
      name: latest.name || normalizedCode,
      shortName: latest.shortName,
      description: null,
      lastPrice: latestPrice,
      dailyReturn: latest.dailyReturn,
      weeklyReturn: 0,
      monthlyReturn: latest.monthlyReturn,
      yearlyReturn: latest.yearlyReturn,
      portfolioSize: portfolioCurrent,
      investorCount: investorCurrent,
      category:
        latest.categoryCode && latest.categoryName
          ? { code: latest.categoryCode, name: latest.categoryName }
          : null,
      fundType: fundTypeResolved,
      logoUrl: getFundLogoUrlForUi(latest.fundId, latest.code, latest.logoUrl, latest.name),
      lastUpdatedAt: latest.date.toISOString(),
      updatedAt: latest.date.toISOString(),
      portfolioManagerInferred: null,
    },
    snapshotDate: latest.date.toISOString(),
    snapshotAlpha: Number.isFinite(latest.alpha) ? latest.alpha : null,
    riskLevel,
    snapshotMetrics,
    priceSeries,
    historyMetrics,
    bestWorstDay,
    modelBenchmark,
    tradingCurrency: "TRY",
    derivedSummary,
    similarFunds: [],
    similarCategoryPeerDailyReturns: [],
    categoryReturnAverages: null,
    kiyasBlock: null,
    trendSeries,
  };

  if (!(Number.isFinite(payload.fund.lastPrice) && payload.fund.lastPrice > 0)) {
    degradedReasons.add("core_latest_price_missing");
  }
  if (!(Number.isFinite(payload.fund.investorCount) && payload.fund.investorCount > 0)) {
    degradedReasons.add("core_investor_current_missing");
  }
  if (!(Number.isFinite(payload.fund.portfolioSize) && payload.fund.portfolioSize > 0)) {
    degradedReasons.add("core_portfolio_current_missing");
  }
  if (payload.priceSeries.length < 2) {
    degradedReasons.add("core_price_series_insufficient");
  }
  if (!investorTrendAvailable) {
    degradedReasons.add("core_investor_trend_missing");
  }
  if (!portfolioTrendAvailable) {
    degradedReasons.add("core_portfolio_trend_missing");
  }
  degradedReasons.add(`core_price_series_source_${performanceSeriesSource}`);

  if (degradedReasons.size > 0 || failedSteps.length > 0) {
    return withDegradedPayload(payload, {
      stale: false,
      partial: true,
      reasons: [...degradedReasons],
      failedSteps,
    });
  }
  return payload;
}

async function tryUpgradeCorePayloadWithPhase1History(
  normalizedCode: string,
  snapshotRowsDesc: LatestSnapshotCoreRow[],
  currentPayload: FundDetailPageData,
  steps: DetailStepDurations
): Promise<FundDetailPageData> {
  if (!shouldTryPhase1HistoryUpgrade(currentPayload)) return currentPayload;
  const latest = snapshotRowsDesc[0];
  if (!latest?.fundId || !(latest.date instanceof Date)) return currentPayload;

  try {
    const historyLoad = await measureStep(steps, "phase1_history_upgrade_query", () =>
      withTimeout(
        loadPriceHistoryBySessionLeanCached({
          fundId: latest.fundId,
          fromDate: new Date(latest.date.getTime() - DETAIL_HISTORY_LOOKBACK_DAYS * DAY_MS),
          toDate: latest.date,
          limit: DETAIL_PHASE1_HISTORY_UPGRADE_LIMIT,
        }),
        DETAIL_PHASE1_HISTORY_UPGRADE_TIMEOUT_MS,
        "phase1_history_upgrade_query"
      )
    );
    const historyRowsDesc = historyLoad.rows;
    if (historyRowsDesc.length < 2) return currentPayload;

    const carryReasons = (currentPayload.degraded?.reasons ?? []).filter(
      (reason) =>
        !reason.startsWith("core_price_series_source_") &&
        reason !== "core_price_series_insufficient" &&
        reason !== "history_fallback_series_used"
    );
    const carryFailedSteps = [...(currentPayload.degraded?.failedSteps ?? [])];
    const candidate = buildCorePayloadFromSnapshotRows(
      normalizedCode,
      snapshotRowsDesc,
      steps,
      new Set<string>(carryReasons),
      carryFailedSteps,
      {
        historyRowsOverride: [...historyRowsDesc].reverse(),
        forcedSeriesSource: "history",
      }
    );
    if (!candidate) return currentPayload;

    const improvedByPointCount = candidate.priceSeries.length > currentPayload.priceSeries.length;
    const improvedByRange =
      candidate.derivedSummary.returnApprox3YearPct != null && currentPayload.derivedSummary.returnApprox3YearPct == null;
    if (improvedByPointCount || improvedByRange) {
      return candidate;
    }
  } catch (error) {
    console.error("[fund-detail] phase1_history_upgrade_query failed", error);
  }

  return currentPayload;
}

/** Artifact’taki dense trend serisi ile chartHistory satırlarından türetilen trend aynı uzunlukta olabilir; daha uzun ve geçerli olanı seç (deterministik). */
function pickLongerServingTrendSeries(
  servingSeries: FundDetailCoreTrendPoint[],
  historyTrend: FundDetailTrendPoint[]
): FundDetailCoreTrendPoint[] {
  const s = Array.isArray(servingSeries) ? servingSeries.length : 0;
  const h = historyTrend.length;
  if (s >= 2 && s >= h) return servingSeries;
  if (h >= 2 && h > s) return historyTrend;
  if (s >= 2) return servingSeries;
  if (h >= 2) return historyTrend;
  return s > 0 ? servingSeries : historyTrend;
}

function coreServingSnapshotLagDays(snapshotDateIso: string | null | undefined): number | null {
  if (typeof snapshotDateIso !== "string" || snapshotDateIso.trim() === "") return null;
  const parsed = new Date(snapshotDateIso);
  if (!Number.isFinite(parsed.getTime())) return null;
  const snapshotDay = startOfUtcDay(parsed);
  const expectedDay = latestExpectedBusinessSessionDate();
  return Math.max(0, Math.round((expectedDay.getTime() - snapshotDay.getTime()) / DAY_MS));
}

function buildCorePayloadFromServingRecord(
  normalizedCode: string,
  serving: FundDetailCoreServingPayload,
  steps: DetailStepDurations,
  degradedReasons: Set<string>,
  failedSteps: string[]
): FundDetailPageData {
  const latestDate = serving.latestSnapshotDate ? new Date(serving.latestSnapshotDate) : null;

  const coreSeriesBuildStartedAt = Date.now();
  const servingHistory = buildHistoryRowsFromServingPayload(serving);
  const servingHistoryRowsDesc =
    servingHistory.rowsDesc.length >= 2 &&
    servingHistory.coverageDays < DETAIL_HISTORY_SERVING_MIN_COVERAGE_DAYS &&
    DETAIL_HISTORY_SERVING_SYNTHETIC_EXTEND &&
    latestDate
      ? extendServingHistoryRowsWithSyntheticAnchors(servingHistory.rowsDesc, {
          date: latestDate,
          price: Number.isFinite(serving.latestPrice) ? serving.latestPrice : 0,
          yearlyReturn: Number.isFinite(serving.yearlyReturn) ? serving.yearlyReturn : 0,
        })
      : servingHistory.rowsDesc;
  const usedSyntheticHistoryExtension = servingHistoryRowsDesc !== servingHistory.rowsDesc;
  const servingHistoryRowsAsc = [...servingHistoryRowsDesc].reverse();
  const servingPoints =
    servingHistoryRowsAsc.length >= 2
      ? dedupeSessionPricePoints(servingHistoryRowsAsc.map((row) => ({ date: row.date, price: row.price })))
      : dedupeSessionPricePoints(
          (Array.isArray(serving.miniPriceSeries) ? serving.miniPriceSeries : [])
            .filter((point) => Number.isFinite(point?.t) && Number.isFinite(point?.p))
            .map((point) => ({ date: new Date(point.t), price: point.p }))
        );
  const approxPoints =
    servingPoints.length >= 2
      ? []
      : buildApproxPricePointsFromReturns(
          latestDate ?? new Date(),
          serving.latestPrice,
          serving.monthlyReturn,
        serving.yearlyReturn
      );
  const points = servingPoints.length >= 2 ? servingPoints : approxPoints;
  const performanceSeriesSource: "serving" | "approx" = servingPoints.length >= 2 ? "serving" : "approx";
  steps.minimal_history_fallback_series_build_ms = Date.now() - coreSeriesBuildStartedAt;

  const trendFromHistory = servingHistoryRowsAsc.length >= 2 ? buildTrendSeries(servingHistoryRowsAsc) : null;
  const fromHistI = trendFromHistory?.investorCount ?? [];
  const fromServI = Array.isArray(serving.investorSummary?.series) ? serving.investorSummary.series : [];
  const investorTrendSource = pickLongerServingTrendSeries(fromServI, fromHistI);
  const fromHistP = trendFromHistory?.portfolioSize ?? [];
  const fromServP = Array.isArray(serving.portfolioSummary?.series) ? serving.portfolioSummary.series : [];
  const portfolioTrendSource = pickLongerServingTrendSeries(fromServP, fromHistP);
  if (shouldLogFundDetailDebug(normalizedCode)) {
    const im = serving.investorSummary.seriesMeta;
    const pm = serving.portfolioSummary.seriesMeta;
    if (im || pm) {
      console.info(
        `[fund-detail-serving-trend-meta] code=${normalizedCode} ` +
          `investor_meta=${JSON.stringify(im ?? null)} portfolio_meta=${JSON.stringify(pm ?? null)} ` +
          `picked_investor_len=${investorTrendSource.length} picked_portfolio_len=${portfolioTrendSource.length} ` +
          `from_history_i=${fromHistI.length} from_history_p=${fromHistP.length}`
      );
    }
  }
  const investorTrend = downsampleTimeSeries(
    normalizeTrendSeriesPoints(investorTrendSource, "investor"),
    DETAIL_TREND_SERIES_MAX_POINTS
  );
  const portfolioTrend = downsampleTimeSeries(
    normalizeTrendSeriesPoints(portfolioTrendSource, "portfolio"),
    DETAIL_TREND_SERIES_MAX_POINTS
  );

  const investorSummaryStartedAt = Date.now();
  const investorCurrent =
    Number.isFinite(serving.investorSummary?.current) && serving.investorSummary.current > 0
      ? Math.round(serving.investorSummary.current)
      : investorTrend[investorTrend.length - 1]?.v ?? 0;
  steps.investor_summary_build_ms = Date.now() - investorSummaryStartedAt;

  const portfolioSummaryStartedAt = Date.now();
  const portfolioCurrent =
    Number.isFinite(serving.portfolioSummary?.current) && serving.portfolioSummary.current > 0
      ? serving.portfolioSummary.current
      : portfolioTrend[portfolioTrend.length - 1]?.v ?? 0;
  steps.portfolio_summary_build_ms = Date.now() - portfolioSummaryStartedAt;

  const historyMetrics = reliableHistoryMetrics(points);
  const bestWorstDay =
    points.length >= 2
      ? bestWorstDailyReturn(
          points.slice(1).map((point, index) => {
            const prev = points[index]!;
            if (!(prev.price > 0)) return { dailyReturn: 0 };
            return { dailyReturn: ((point.price - prev.price) / prev.price) * 100 };
          })
        )
      : null;
  const rolling = bestWorstRollingTradingWindow(points, ROLLING_TRADING_DAYS);
  const derivedSummary: FundDetailDerivedSummary = {
    returnApprox1YearPct: returnApproxCalendarDays(points, 365),
    returnApprox2YearPct: returnApproxCalendarDays(points, 730),
    returnApprox3YearPct: returnApproxCalendarDays(points, 1095),
    bestRollingMonthPct: rolling?.bestPct ?? null,
    worstRollingMonthPct: rolling?.worstPct ?? null,
  };

  const categoryCode = serving.fund.categoryCode ?? "";
  const benchCode = categoryCode ? getBenchmarkForCategory(categoryCode) : null;
  const modelBenchmark = benchCode ? { code: benchCode, label: getBenchmarkName(benchCode) } : null;
  const fundTypeResolved =
    serving.fund.fundTypeCode != null && serving.fund.fundTypeName
      ? {
          code: serving.fund.fundTypeCode,
          name: fundTypeDisplayLabel({
            code: serving.fund.fundTypeCode,
            name: serving.fund.fundTypeName,
          }),
        }
      : null;

  const payload: FundDetailPageData = {
    fund: {
      code: serving.fund.code || normalizedCode,
      name: serving.fund.name || normalizedCode,
      shortName: serving.fund.shortName,
      description: null,
      lastPrice: Number.isFinite(serving.latestPrice) ? serving.latestPrice : 0,
      dailyReturn: Number.isFinite(serving.dailyChangePct) ? serving.dailyChangePct : 0,
      weeklyReturn: 0,
      monthlyReturn: Number.isFinite(serving.monthlyReturn) ? serving.monthlyReturn : 0,
      yearlyReturn: Number.isFinite(serving.yearlyReturn) ? serving.yearlyReturn : 0,
      portfolioSize: Number.isFinite(portfolioCurrent) ? portfolioCurrent : 0,
      investorCount: Number.isFinite(investorCurrent) ? investorCurrent : 0,
      category:
        serving.fund.categoryCode && serving.fund.categoryName
          ? { code: serving.fund.categoryCode, name: serving.fund.categoryName }
          : null,
      fundType: fundTypeResolved,
      logoUrl: getFundLogoUrlForUi(
        serving.fund.fundId,
        serving.fund.code || normalizedCode,
        serving.fund.logoUrl,
        serving.fund.name || normalizedCode
      ),
      lastUpdatedAt: latestDate ? latestDate.toISOString() : null,
      updatedAt: serving.generatedAt,
      portfolioManagerInferred: null,
    },
    snapshotDate: latestDate ? latestDate.toISOString() : null,
    snapshotAlpha: Number.isFinite(serving.snapshotAlpha) ? serving.snapshotAlpha : null,
    riskLevel: parseRiskLevel(serving.riskLevel) ?? determineRiskLevel(categoryCode, serving.fund.name || normalizedCode),
    snapshotMetrics: parseFundMetricsJson(serving.snapshotMetrics),
    priceSeries: downsampleTimeSeries(points, DETAIL_PRICE_SERIES_MAX_POINTS).map((point) => ({
      t: point.date.getTime(),
      p: point.price,
    })),
    historyMetrics,
    bestWorstDay,
    modelBenchmark,
    tradingCurrency: "TRY",
    derivedSummary,
    similarFunds: [],
    similarCategoryPeerDailyReturns: [],
    categoryReturnAverages: null,
    kiyasBlock: null,
    trendSeries: {
      investorCount: investorTrend,
      portfolioSize: portfolioTrend,
    },
  };

  if (!(Number.isFinite(payload.fund.lastPrice) && payload.fund.lastPrice > 0)) {
    degradedReasons.add("core_latest_price_missing");
  }
  if (!(Number.isFinite(payload.fund.investorCount) && payload.fund.investorCount > 0)) {
    degradedReasons.add("core_investor_current_missing");
  }
  if (!(Number.isFinite(payload.fund.portfolioSize) && payload.fund.portfolioSize > 0)) {
    degradedReasons.add("core_portfolio_current_missing");
  }
  if (payload.priceSeries.length < 2) {
    degradedReasons.add("core_price_series_insufficient");
  }
  if (payload.trendSeries.investorCount.length < 2) {
    degradedReasons.add("core_investor_trend_missing");
  }
  if (payload.trendSeries.portfolioSize.length < 2) {
    degradedReasons.add("core_portfolio_trend_missing");
  }
  if (usedSyntheticHistoryExtension) {
    degradedReasons.add("history_serving_synthetic_extension");
    degradedReasons.add("history_serving_insufficient_coverage");
  }
  degradedReasons.add(`core_price_series_source_${performanceSeriesSource}`);

  if (degradedReasons.size > 0 || failedSteps.length > 0) {
    return withDegradedPayload(payload, {
      stale: false,
      partial: true,
      reasons: [...degradedReasons],
      failedSteps,
    });
  }

  return payload;
}

async function getFundDetailPageDataUncached(
  rawCode: string,
  options?: { phase?: "phase1" | "phase2"; phase2QueueWaitMs?: number; alternativesSeed?: FundDetailSimilarFund[] }
): Promise<FundDetailPageData | null> {
  const startedAt = Date.now();
  const state = getDetailRuntimeState();
  const steps: DetailStepDurations = {};
  const failedSteps: string[] = [];
  const degradedReasons = new Set<string>();
  const phase = options?.phase === "phase2" ? "phase2" : "phase1";
  const normalizedCode = rawCode.trim().toUpperCase();
  if (!normalizedCode) return null;
  console.info(`[fund-detail-lifecycle] code=${normalizedCode} event=${phase}_started`);
  if (phase === "phase2" && Number.isFinite(options?.phase2QueueWaitMs)) {
    steps.phase2_queue_wait_ms = Math.max(0, Math.round(options?.phase2QueueWaitMs ?? 0));
  }

  if (phase === "phase1") {
    let servingPayload: FundDetailCoreServingPayload | null = null;
    let servingSource: "memory" | "file" | "db" | "ondemand" | "miss" = "miss";
    let servingAgeMs: number | null = null;
    let servingSnapshotLagDays: number | null = null;
    let servingMissReason: string | null = null;
    try {
      const servingRead = await measureStep(steps, "core_serving_read", () =>
        withTimeout(
          getFundDetailCoreServingCached(normalizedCode, { preferFileOnly: DETAIL_CORE_SERVING_FILE_ONLY }),
          DETAIL_CORE_SERVING_READ_TIMEOUT_MS,
          "core_serving_read"
        )
      );
      servingPayload = servingRead.payload;
      servingSource = servingRead.source;
      servingAgeMs = servingRead.ageMs;
      servingMissReason = servingRead.missReason ?? null;
      steps.cache_read = servingRead.readMs;
      steps.cache_read_duration = servingRead.readMs;
      if (servingAgeMs != null) {
        steps.cache_age_ms = Math.round(servingAgeMs);
      }
      if (servingRead.source === "db" || servingRead.source === "ondemand") {
        steps.latest_snapshot_db_exec_ms = Math.round(servingRead.readMs);
        steps.latest_snapshot_checkout_wait_ms = Math.max(0, Math.round((steps.core_serving_read ?? 0) - servingRead.readMs));
      }
    } catch (error) {
      console.error("[fund-detail] core_serving_read failed", error);
      failedSteps.push("core_serving_read");
      degradedReasons.add("core_serving_read_failed");
    }

    // Core yolunda fund tablosu zorunlu sorgu değil; pool baskısında bu adımı bilinçli atlıyoruz.
    steps.core_fund_query = 0;
    console.info(
      `[fund-detail-core-serving] code=${normalizedCode} source=${servingSource} hit=${servingPayload ? 1 : 0} ` +
        `read_ms=${steps.core_serving_read ?? 0} generated_age_ms=${servingAgeMs ?? -1} miss_reason=${servingMissReason ?? "none"} ` +
        `chart_points=${servingPayload?.chartHistory?.points?.length ?? 0} chart_mode=${servingPayload?.chartHistory?.mode ?? "none"} ` +
        `file_only=${DETAIL_CORE_SERVING_FILE_ONLY ? 1 : 0}`
    );

    if (servingPayload) {
      const universeSnapshotHint = await measureStep(steps, "core_serving_snapshot_hint", () =>
        withTimeout(
          getFundDetailCoreServingSnapshotDateHint(),
          DETAIL_CORE_SERVING_READ_TIMEOUT_MS,
          "core_serving_snapshot_hint"
        )
      ).catch(() => null);
      servingSnapshotLagDays = coreServingSnapshotLagDays(servingPayload.latestSnapshotDate);
      if (servingSnapshotLagDays != null) {
        steps.core_serving_snapshot_lag_days = servingSnapshotLagDays;
      }
      if (universeSnapshotHint) {
        const rowSnapshotMs = Date.parse(servingPayload.latestSnapshotDate ?? "");
        const universeSnapshotMs = universeSnapshotHint.getTime();
        if (Number.isFinite(rowSnapshotMs) && Number.isFinite(universeSnapshotMs)) {
          const lagDecision = shouldDropServingRowForUniverseLag({
            rowSnapshotMs,
            universeSnapshotMs,
            maxLagDays: DETAIL_CORE_SERVING_ROW_LAG_VS_UNIVERSE_MAX_DAYS,
          });
          const lagDays = lagDecision.lagDays;
          steps.core_serving_row_lag_vs_universe_days = lagDays;
          // Small lag is allowed so previous-good serving data remains eligible.
          if (lagDecision.rowBehindUniverse) {
            degradedReasons.add("core_serving_row_behind_universe");
            if (lagDecision.shouldDrop) {
              degradedReasons.add("core_serving_snapshot_stale");
              servingMissReason = `row_snapshot_lag_${lagDays}d_vs_universe`;
              servingPayload = null;
              servingSource = "miss";
            }
          }
        }
      }
      if (
        servingSnapshotLagDays != null &&
        servingSnapshotLagDays > DETAIL_CORE_SERVING_MAX_SNAPSHOT_LAG_DAYS
      ) {
        degradedReasons.add("core_serving_snapshot_stale");
        servingMissReason = `snapshot_stale_${servingSnapshotLagDays}d`;
        servingPayload = null;
        servingSource = "miss";
      }
    }

    if (servingPayload) {
      const phase1ServingSeed = buildLatestSnapshotRowFromServing(normalizedCode, servingPayload);
      if (phase1ServingSeed) {
        setPhase2SnapshotSeed(state, normalizedCode, phase1ServingSeed, "phase1_serving");
      }
      if (servingAgeMs != null && servingAgeMs > DETAIL_CORE_SERVING_STALE_MS) {
        steps.core_serving_stale_age_ms = Math.round(servingAgeMs);
      }
      let payload = buildCorePayloadFromServingRecord(
        normalizedCode,
        servingPayload,
        steps,
        degradedReasons,
        failedSteps
      );
      let phase1AlternativesSource: "serving_file" | "serving_memory" | "funds_list" | "none" = "none";
      let phase1AlternativesFallbackUsed = false;
      let phase1AlternativesReason = "none";
      const phase1CategoryCode = payload.fund.category?.code ?? null;
      if (payload.similarFunds.length === 0 && phase1CategoryCode) {
        const servingAlternatives = await listFundDetailCoreServingAlternatives(
          normalizedCode,
          FUND_ALTERNATIVES_CANDIDATE_POOL
        );
        if (servingAlternatives.rows.length > 0) {
          const candidates: FundAlternativeCandidate[] = servingAlternatives.rows.map((row) => ({
            code: row.code,
            name: row.name,
            shortName: row.shortName,
            lastPrice: row.lastPrice,
            dailyReturn: row.dailyReturn,
            logoUrl: getFundLogoUrlForUi(row.fundId, row.code, row.logoUrl, row.name),
            portfolioSize: row.portfolioSize,
            investorCount: row.investorCount,
            monthlyReturn: row.monthlyReturn,
            yearlyReturn: row.yearlyReturn,
          }));
          payload = {
            ...payload,
            similarFunds: buildFundAlternatives(
              {
                portfolioSize: payload.fund.portfolioSize,
                investorCount: payload.fund.investorCount,
                dailyReturn: payload.fund.dailyReturn,
                monthlyReturn: payload.fund.monthlyReturn,
                yearlyReturn: payload.fund.yearlyReturn,
              },
              candidates
            ),
            similarCategoryPeerDailyReturns: candidates
              .map((candidate) => candidate.dailyReturn)
              .filter((value) => Number.isFinite(value)),
          };
          phase1AlternativesSource =
            servingAlternatives.source === "memory" ? "serving_memory" : "serving_file";
          phase1AlternativesFallbackUsed = true;
        } else {
          phase1AlternativesReason = servingAlternatives.missReason ?? "cache_empty";
        }
        if (payload.similarFunds.length === 0) {
          const fundsListCandidates = await listFundDetailFundsListAlternatives(
            normalizedCode,
            phase1CategoryCode,
            FUND_ALTERNATIVES_CANDIDATE_POOL
          );
          if (fundsListCandidates.length > 0) {
            payload = {
              ...payload,
              similarFunds: buildFundAlternatives(
                {
                  portfolioSize: payload.fund.portfolioSize,
                  investorCount: payload.fund.investorCount,
                  dailyReturn: payload.fund.dailyReturn,
                  monthlyReturn: payload.fund.monthlyReturn,
                  yearlyReturn: payload.fund.yearlyReturn,
                },
                fundsListCandidates
              ),
              similarCategoryPeerDailyReturns: fundsListCandidates
                .map((candidate) => candidate.dailyReturn)
                .filter((value) => Number.isFinite(value)),
            };
            phase1AlternativesSource = "funds_list";
            phase1AlternativesFallbackUsed = true;
            phase1AlternativesReason = "funds_list_fallback";
          }
        }
      }
      let chosenSeriesSource: "history" | "snapshot_fallback" | "approx" | "serving" = "serving";
      if (payload) {
        const servingNeedsUpgrade =
          payload.priceSeries.length < DETAIL_PHASE1_HISTORY_UPGRADE_MIN_POINTS ||
          payload.trendSeries.investorCount.length < 2 ||
          payload.trendSeries.portfolioSize.length < 2;
        if (DETAIL_PHASE1_SERVING_UPGRADE_ENABLED && DETAIL_CORE_SNAPSHOT_FALLBACK_ENABLED && servingNeedsUpgrade) {
          try {
            const coreSeries = await measureStep(steps, "core_snapshot_series_query", () =>
              withTimeout(
                loadCoreSnapshotSeriesLean(normalizedCode, DETAIL_CORE_SNAPSHOT_FALLBACK_LIMIT),
                DETAIL_CORE_SNAPSHOT_FALLBACK_TIMEOUT_MS,
                "core_snapshot_series_query"
              )
            );
            if (coreSeries.dbExecMs != null) {
              steps.latest_snapshot_db_exec_ms = Math.round(coreSeries.dbExecMs);
              steps.latest_snapshot_checkout_wait_ms = Math.max(
                0,
                Math.round((steps.core_snapshot_series_query ?? 0) - coreSeries.dbExecMs)
              );
            }
            if (coreSeries.rows.length > 0) {
              setPhase2SnapshotSeed(state, normalizedCode, coreSeries.rows[0]!, "phase1_snapshot");
              const snapshotCandidate = buildCorePayloadFromSnapshotRows(
                normalizedCode,
                coreSeries.rows,
                steps,
                new Set<string>(degradedReasons),
                [...failedSteps]
              );
              if (snapshotCandidate) {
                const upgradedCandidate = await tryUpgradeCorePayloadWithPhase1History(
                  normalizedCode,
                  coreSeries.rows,
                  snapshotCandidate,
                  steps
                );
                const candidateImproves =
                  hasRequiredCoreData(upgradedCandidate) ||
                  upgradedCandidate.priceSeries.length > payload.priceSeries.length ||
                  upgradedCandidate.trendSeries.investorCount.length > payload.trendSeries.investorCount.length ||
                  upgradedCandidate.trendSeries.portfolioSize.length > payload.trendSeries.portfolioSize.length;
                if (candidateImproves) {
                  payload = upgradedCandidate;
                  chosenSeriesSource = upgradedCandidate.degraded?.reasons?.includes("core_price_series_source_history")
                    ? "history"
                    : upgradedCandidate.degraded?.reasons?.includes("core_price_series_source_snapshot_fallback")
                      ? "snapshot_fallback"
                      : upgradedCandidate.degraded?.reasons?.includes("core_price_series_source_approx")
                        ? "approx"
                        : "history";
                }
              }
            }
          } catch (error) {
            console.warn("[fund-detail] core_snapshot_series_query degraded (serving upgrade)", error);
            failedSteps.push("core_snapshot_series_query");
            degradedReasons.add("core_snapshot_series_query_failed");
          }
        } else if (!DETAIL_PHASE1_SERVING_UPGRADE_ENABLED) {
          steps.core_snapshot_series_query = 0;
        }
        const totalMs = Date.now() - startedAt;
        steps.total_core_pipeline_duration = totalMs;
        steps.total_route_duration = totalMs;
        const servedType = inferCacheKind(payload);
        const seriesSource: "history" | "snapshot_fallback" | "approx" | "serving" =
          chosenSeriesSource !== "serving"
            ? chosenSeriesSource
            : payload.degraded?.reasons?.includes("core_price_series_source_history")
              ? "history"
              : payload.degraded?.reasons?.includes("core_price_series_source_snapshot_fallback")
                ? "snapshot_fallback"
                : payload.degraded?.reasons?.includes("core_price_series_source_approx")
                  ? "approx"
                  : "serving";
        emitFundDetailDebugLog(normalizedCode, payload, {
          seriesSource,
          servingHit: true,
          servingMissReason,
          managerSource: "none",
        });
        if (shouldLogFundDetailDebug(normalizedCode)) {
          const range = coreSeriesDateRange(payload);
          console.info(
            `[fund-detail-phase-series] code=${normalizedCode} phase=phase1 source=${seriesSource} ` +
              `points=${range.pointCount} min_date=${range.minIso} max_date=${range.maxIso}`
          );
        }
        console.info(
          `[fund-detail-core] code=${normalizedCode} serving_read_ms=${steps.core_serving_read ?? 0} ` +
            `serving_source=${servingSource} serving_age_ms=${servingAgeMs ?? -1} serving_stale=${steps.core_serving_stale_age_ms ? 1 : 0} ` +
            `serving_snapshot_lag_days=${servingSnapshotLagDays ?? -1} ` +
            `core_fund_query_ms=${steps.core_fund_query ?? 0} ` +
            `minimal_history_build_ms=${steps.minimal_history_fallback_series_build_ms ?? 0} ` +
            `investor_summary_build_ms=${steps.investor_summary_build_ms ?? 0} ` +
            `portfolio_summary_build_ms=${steps.portfolio_summary_build_ms ?? 0} total_core_pipeline_ms=${totalMs} ` +
            `latest_price_source=core_serving investor_source=core_serving portfolio_source=core_serving ` +
            `served_payload_type=${servedType} serving_source=${servingSource}`
        );
        console.info(
          `[fund-detail-alternatives] code=${normalizedCode} alternatives_source=${phase1AlternativesSource} ` +
            `alternatives_count=${payload.similarFunds.length} alternatives_fallback_used=${phase1AlternativesFallbackUsed ? 1 : 0} ` +
            `alternatives_degraded_reason=${phase1AlternativesReason}`
        );
        console.info(
          `[fund-detail-lifecycle] code=${normalizedCode} event=phase1_returned partial=${payload.degraded?.partial ? 1 : 0} degraded=${payload.degraded?.active ? 1 : 0}`
        );
        return payload;
      }
    }

    degradedReasons.add("core_serving_miss_or_failed");
    if (servingMissReason) {
      degradedReasons.add(`core_serving_miss_${servingMissReason}`);
    }

    let snapshotFallbackPayload: FundDetailPageData | null = null;
    if (DETAIL_CORE_SNAPSHOT_FALLBACK_ENABLED) {
      try {
        const coreSeries = await measureStep(steps, "core_snapshot_series_query", () =>
          withTimeout(
            loadCoreSnapshotSeriesLean(normalizedCode, DETAIL_CORE_SNAPSHOT_FALLBACK_LIMIT),
            DETAIL_CORE_SNAPSHOT_FALLBACK_TIMEOUT_MS,
            "core_snapshot_series_query"
          )
        );
        if (coreSeries.dbExecMs != null) {
          steps.latest_snapshot_db_exec_ms = Math.round(coreSeries.dbExecMs);
          steps.latest_snapshot_checkout_wait_ms = Math.max(
            0,
            Math.round((steps.core_snapshot_series_query ?? 0) - coreSeries.dbExecMs)
          );
        }
        if (coreSeries.rows.length > 0) {
          setPhase2SnapshotSeed(state, normalizedCode, coreSeries.rows[0]!, "phase1_snapshot");
          snapshotFallbackPayload = buildCorePayloadFromSnapshotRows(
            normalizedCode,
            coreSeries.rows,
            steps,
            degradedReasons,
            failedSteps
          );
          if (snapshotFallbackPayload) {
            snapshotFallbackPayload = await tryUpgradeCorePayloadWithPhase1History(
              normalizedCode,
              coreSeries.rows,
              snapshotFallbackPayload,
              steps
            );
          }
        } else {
          degradedReasons.add("core_snapshot_series_empty");
        }
      } catch (error) {
        console.warn("[fund-detail] core_snapshot_series_query degraded", error);
        failedSteps.push("core_snapshot_series_query");
        degradedReasons.add("core_snapshot_series_query_failed");
      }
    } else {
      steps.core_snapshot_series_query = 0;
      degradedReasons.add("core_snapshot_fallback_disabled");
    }

    if (snapshotFallbackPayload) {
      const totalMs = Date.now() - startedAt;
      steps.total_core_pipeline_duration = totalMs;
      steps.total_route_duration = totalMs;
      const servedType = inferCacheKind(snapshotFallbackPayload);
      console.info(
        `[fund-detail-core] code=${normalizedCode} source=snapshot-fallback total_core_pipeline_ms=${totalMs} ` +
          `latest_price_source=snapshot_series investor_source=snapshot_series portfolio_source=snapshot_series ` +
          `served_payload_type=${servedType} steps=${JSON.stringify(steps)}`
      );
      emitFundDetailDebugLog(normalizedCode, snapshotFallbackPayload, {
        seriesSource: snapshotFallbackPayload.degraded?.reasons?.includes("core_price_series_source_approx")
          ? "approx"
          : snapshotFallbackPayload.degraded?.reasons?.includes("core_price_series_source_snapshot_fallback")
            ? "snapshot_fallback"
            : "history",
        servingHit: false,
        servingMissReason,
        managerSource: "none",
      });
      if (shouldLogFundDetailDebug(normalizedCode)) {
        const range = coreSeriesDateRange(snapshotFallbackPayload);
        const source =
          snapshotFallbackPayload.degraded?.reasons?.includes("core_price_series_source_approx")
            ? "approx"
            : snapshotFallbackPayload.degraded?.reasons?.includes("core_price_series_source_snapshot_fallback")
              ? "snapshot_fallback"
              : snapshotFallbackPayload.degraded?.reasons?.includes("core_price_series_source_history")
                ? "history"
                : "history";
        console.info(
          `[fund-detail-phase-series] code=${normalizedCode} phase=phase1 source=${source} ` +
            `points=${range.pointCount} min_date=${range.minIso} max_date=${range.maxIso}`
        );
      }
      console.info(
        `[fund-detail-lifecycle] code=${normalizedCode} event=phase1_returned partial=${snapshotFallbackPayload.degraded?.partial ? 1 : 0} degraded=${snapshotFallbackPayload.degraded?.active ? 1 : 0}`
      );
      return snapshotFallbackPayload;
    }

    const minimalPayload = await measureStep(steps, "minimal_payload_build", () =>
      buildMinimalDetailPayloadFromFundTable(normalizedCode, steps, failedSteps, degradedReasons)
    );
    if (minimalPayload && hasRequiredCoreData(minimalPayload)) {
      const totalMs = Date.now() - startedAt;
      steps.total_core_pipeline_duration = totalMs;
      steps.total_route_duration = totalMs;
      const degradedPayload = withDegradedPayload(minimalPayload, {
        stale: false,
        partial: true,
        reasons: [...degradedReasons],
        failedSteps,
      });
      console.info(
        `[fund-detail-core] code=${normalizedCode} source=minimal-priority total_core_pipeline_ms=${totalMs} ` +
          `latest_price_source=fund_table investor_source=fund_table portfolio_source=fund_table ` +
          `served_payload_type=${inferCacheKind(degradedPayload)} steps=${JSON.stringify(steps)}`
      );
      emitFundDetailDebugLog(normalizedCode, degradedPayload, {
        seriesSource: "approx",
        servingHit: false,
        servingMissReason,
        managerSource: "none",
      });
      console.info(`[fund-detail-lifecycle] code=${normalizedCode} event=phase1_returned partial=1 degraded=1`);
      return degradedPayload;
    }

    if (minimalPayload) {
      degradedReasons.add("minimal_core_incomplete");
    }

    if (minimalPayload) {
      const totalMs = Date.now() - startedAt;
      steps.total_core_pipeline_duration = totalMs;
      steps.total_route_duration = totalMs;
      const degradedPayload = withDegradedPayload(minimalPayload, {
        stale: false,
        partial: true,
        reasons: [...degradedReasons],
        failedSteps,
      });
      console.info(
        `[fund-detail-core] code=${normalizedCode} source=minimal-fallback total_core_pipeline_ms=${totalMs} ` +
          `latest_price_source=fund_table investor_source=fund_table portfolio_source=fund_table ` +
          `served_payload_type=${inferCacheKind(degradedPayload)} snapshot_fallback_enabled=${DETAIL_CORE_SNAPSHOT_FALLBACK_ENABLED ? 1 : 0} ` +
          `steps=${JSON.stringify(steps)}`
      );
      emitFundDetailDebugLog(normalizedCode, degradedPayload, {
        seriesSource: "approx",
        servingHit: false,
        servingMissReason,
        managerSource: "none",
      });
      console.info(`[fund-detail-lifecycle] code=${normalizedCode} event=phase1_returned partial=1 degraded=1`);
      return degradedPayload;
    }

    if (!minimalPayload) {
      if (failedSteps.length > 0) {
        const emergencyPayload = withDegradedPayload(buildEmergencyDetailFallbackPayload(normalizedCode), {
          stale: false,
          partial: true,
          reasons: [...degradedReasons, "emergency_fallback_payload"],
          failedSteps,
        });
        const totalMs = Date.now() - startedAt;
        steps.total_core_pipeline_duration = totalMs;
        steps.total_route_duration = totalMs;
        console.error(
          `[fund-detail-core] code=${normalizedCode} source=emergency total_core_pipeline_ms=${totalMs} steps=${JSON.stringify(steps)}`
        );
        emitFundDetailDebugLog(normalizedCode, emergencyPayload, {
          seriesSource: "approx",
          servingHit: false,
          servingMissReason,
          managerSource: "none",
        });
        console.info(
          `[fund-detail-lifecycle] code=${normalizedCode} event=phase1_returned partial=1 degraded=1`
        );
        return emergencyPayload;
      }
      const totalMs = Date.now() - startedAt;
      steps.total_core_pipeline_duration = totalMs;
      steps.total_route_duration = totalMs;
      console.info(
        `[fund-detail-core] code=${normalizedCode} source=minimal-null total_core_pipeline_ms=${totalMs} steps=${JSON.stringify(steps)}`
      );
      console.info(`[fund-detail-lifecycle] code=${normalizedCode} event=phase1_returned partial=1 degraded=1`);
      return null;
    }
  }

  let phase2PrismaCalls = 0;
  let phase2DuplicatedQueryPrevented = 0;
  let phase2KiyasTimedOut = false;
  let phase2KiyasDbCalls = 0;
  let snapshotCacheHit = false;
  let snapshotDeduped = false;
  let priceHistoryCacheHit = false;
  let priceHistoryDeduped = false;
  let priceHistoryLimitCompatibleCacheHit = false;
  let priceHistoryLimitCompatibleInFlightHit = false;
  let priceHistoryCooldownActive = false;
  let priceHistoryFailureCategory = "none";
  let historyServingSource: "memory" | "file" | "db" | "ondemand" | "miss" | "none" = "none";
  let historyServingHit = false;
  let historyServingPoints = 0;
  let historyServingRange = "none..none";
  let historyServingStalenessMs = -1;
  let historyServingSnapshotLagDays: number | null = null;
  let historyFallbackUsed = false;
  let historyDownsampleMode = "none";
  let historyArtifactVersion = "none";
  let historyArtifactGeneratedAt = "none";
  let historyArtifactSource = "none";
  let priceHistoryRowsCount = 0;
  let priceHistoryRawRowsCount = 0;
  let priceHistorySelectedFromIso = "none";
  let priceHistorySelectedToIso = "none";
  let priceHistorySource: "snapshot" | "history" | "serving" | "none" = "none";
	  let priceHistoryQueryPlan:
	    | "full_distinct"
	    | "snapshot_fastpath"
	    | "snapshot_fastpath_after_live_failure"
	    | "snapshot_fastpath_cooldown"
	    | "snapshot_rest_fallback"
	    | "raw_desc_js_dedupe"
    | "raw_desc_js_dedupe_full_fallback"
    | "none" = "none";
  let priceHistoryColumns = "none";
  let liveHistoryPathAttempted = false;
  let liveHistoryPathFailed = false;
  let liveHistoryPathFailureReason = "none";
  let liveHistoryRestFallbackUsed = false;
  let snapshotSeededFromServing = false;
  let phase2ServingSeedSource: "phase1_serving" | "phase1_snapshot" | "memory" | "file" | "none" = "none";
  let requestReusedContext = false;
  let latestSnapshot: LatestSnapshotCoreRow | null = null;
  let latestSnapshotDbExecMs: number | null = null;
  let firstCheckoutTarget:
    | "latest_snapshot_query"
    | "price_history_query"
    | "none" = "none";
  let firstCheckoutWaitMs = 0;
  const markFirstCheckoutWait = (target: "latest_snapshot_query" | "price_history_query", waitMs: number): void => {
    if (firstCheckoutTarget !== "none") return;
    if (!Number.isFinite(waitMs) || waitMs <= 0) return;
    firstCheckoutTarget = target;
    firstCheckoutWaitMs = Math.max(0, Math.round(waitMs));
  };
  const phase2SnapshotSeed = phase === "phase2" ? getPhase2SnapshotSeed(state, normalizedCode) : null;
  if (phase2SnapshotSeed) {
    latestSnapshot = phase2SnapshotSeed.row;
    latestSnapshotDbExecMs = 0;
    snapshotSeededFromServing = phase2SnapshotSeed.source === "phase1_serving";
    phase2ServingSeedSource = phase2SnapshotSeed.source;
    requestReusedContext = true;
    phase2DuplicatedQueryPrevented += 1;
    steps.latest_snapshot_query = 0;
    steps.latest_snapshot_db_exec_ms = 0;
    steps.latest_snapshot_checkout_wait_ms = 0;
  }
  if (phase === "phase2" && DETAIL_PHASE2_REUSE_SERVING_LATEST && !latestSnapshot) {
    try {
      const servingSeed = await measureStep(steps, "phase2_serving_seed_read", () =>
        withTimeout(
          getFundDetailCoreServingCached(normalizedCode, { preferFileOnly: true }),
          DETAIL_PHASE2_SERVING_SEED_TIMEOUT_MS,
          "phase2_serving_seed_read"
        )
      );
      const seededSnapshot = servingSeed.payload
        ? buildLatestSnapshotRowFromServing(normalizedCode, servingSeed.payload)
        : null;
      const seedSnapshotLagDays = coreServingSnapshotLagDays(servingSeed.payload?.latestSnapshotDate);
      if (
        seededSnapshot &&
        (seedSnapshotLagDays == null || seedSnapshotLagDays <= DETAIL_CORE_SERVING_MAX_SNAPSHOT_LAG_DAYS)
      ) {
        latestSnapshot = seededSnapshot;
        latestSnapshotDbExecMs = 0;
        snapshotSeededFromServing = true;
        requestReusedContext = true;
        phase2ServingSeedSource = servingSeed.source === "memory" || servingSeed.source === "file" ? servingSeed.source : "none";
        phase2DuplicatedQueryPrevented += 1;
        steps.latest_snapshot_query = 0;
        steps.latest_snapshot_db_exec_ms = 0;
        steps.latest_snapshot_checkout_wait_ms = 0;
      } else if (
        seededSnapshot &&
        seedSnapshotLagDays != null &&
        seedSnapshotLagDays > DETAIL_CORE_SERVING_MAX_SNAPSHOT_LAG_DAYS
      ) {
        degradedReasons.add("core_serving_snapshot_stale");
      }
    } catch (error) {
      console.warn("[fund-detail] phase2_serving_seed_read failed", error);
      steps.phase2_serving_seed_read = 0;
    }
  }

  if (!latestSnapshot) {
    try {
      const latest = await measureStep(steps, "latest_snapshot_query", () =>
        withTimeout(
          loadLatestSnapshotLeanCached(normalizedCode),
          DETAIL_LATEST_SNAPSHOT_TIMEOUT_MS,
          "latest_snapshot_query"
        )
      );
      snapshotCacheHit = latest.cacheHit;
      snapshotDeduped = latest.deduped;
      if (latest.cacheHit || latest.deduped) {
        requestReusedContext = true;
      }
      phase2PrismaCalls += latest.dbQueryCount;
      if (latest.cacheHit || latest.deduped) {
        phase2DuplicatedQueryPrevented += 1;
      }
      latestSnapshot = latest.row;
      latestSnapshotDbExecMs = latest.dbExecMs;
      if (latestSnapshotDbExecMs != null && !latest.cacheHit && !latest.deduped) {
        steps.latest_snapshot_db_exec_ms = Math.round(latestSnapshotDbExecMs);
        const checkoutWaitMs = Math.max(
          0,
          Math.round((steps.latest_snapshot_query ?? 0) - latestSnapshotDbExecMs)
        );
        steps.latest_snapshot_checkout_wait_ms = checkoutWaitMs;
        markFirstCheckoutWait("latest_snapshot_query", checkoutWaitMs);
      } else if (latest.cacheHit || latest.deduped) {
        steps.latest_snapshot_db_exec_ms = 0;
        steps.latest_snapshot_checkout_wait_ms = 0;
      }
    } catch (error) {
      console.warn("[fund-detail] latest_snapshot_query degraded", error);
      failedSteps.push("latest_snapshot_query");
      degradedReasons.add("latest_snapshot_query_failed");
    }
  }

  if (!latestSnapshot) {
    degradedReasons.add("latest_snapshot_missing_or_failed");
    const minimalPayload = await measureStep(steps, "minimal_payload_build", () =>
      buildMinimalDetailPayloadFromFundTable(normalizedCode, steps, failedSteps, degradedReasons)
    );
    if (!minimalPayload) {
      if (failedSteps.length > 0) {
        const emergencyPayload = withDegradedPayload(buildEmergencyDetailFallbackPayload(normalizedCode), {
          stale: false,
          partial: true,
          reasons: [...degradedReasons, "emergency_fallback_payload"],
          failedSteps,
        });
        const totalMs = Date.now() - startedAt;
        steps.total_route_duration = totalMs;
        steps.phase1_returned = totalMs;
        console.error(
          `[fund-detail] code=${normalizedCode} source=emergency total_ms=${totalMs} steps=${JSON.stringify(steps)}`
        );
        console.info(
          `[fund-detail-lifecycle] code=${normalizedCode} event=phase2_completed partial=1 degraded=1`
        );
        return emergencyPayload;
      }
      const totalMs = Date.now() - startedAt;
      steps.total_route_duration = totalMs;
      steps.phase1_returned = totalMs;
      console.info(
        `[fund-detail] code=${normalizedCode} source=minimal total_ms=${totalMs} result=null steps=${JSON.stringify(steps)}`
      );
      console.info(
        `[fund-detail-lifecycle] code=${normalizedCode} event=phase2_completed partial=1 degraded=1`
      );
      return null;
    }
    const totalMs = Date.now() - startedAt;
    steps.total_route_duration = totalMs;
    const degradedPayload = withDegradedPayload(minimalPayload, {
      stale: false,
      partial: true,
      reasons: [...degradedReasons],
      failedSteps,
    });
    console.info(
      `[fund-detail] code=${normalizedCode} source=minimal total_ms=${totalMs} steps=${JSON.stringify(steps)}`
    );
    console.info(
      `[fund-detail-lifecycle] code=${normalizedCode} event=phase2_completed partial=1 degraded=1`
    );
    return degradedPayload;
  }

  let fundCore: {
    id: string;
    categoryId: string | null;
    description: string | null;
    weeklyReturn: number;
    lastUpdatedAt: Date | null;
    updatedAt: Date;
  } | null = null;
  const phase2Context: {
    fundId: string;
    snapshotDate: Date;
    categoryCode: string | null;
    categoryId: string | null;
  } = {
    fundId: latestSnapshot.fundId,
    snapshotDate: latestSnapshot.date,
    categoryCode: latestSnapshot.categoryCode,
    categoryId: null,
  };
  const phase1MinimalActive = false;
  const adaptiveRescueActive = false;
  const rescueModeActive = phase1MinimalActive || DETAIL_RESCUE_MODE || adaptiveRescueActive;
  if (phase1MinimalActive) degradedReasons.add("phase1_minimal_mode");
  if (DETAIL_RESCUE_MODE) degradedReasons.add("rescue_mode_minimal_payload");
  if (!DETAIL_RESCUE_MODE && adaptiveRescueActive) degradedReasons.add("adaptive_rescue_mode");

  const historyFromDate = new Date(phase2Context.snapshotDate.getTime() - DETAIL_HISTORY_LOOKBACK_DAYS * DAY_MS);
  let historyRows: FundHistoryRow[] = [];
  let servingRowsForFallback: FundHistoryRow[] = [];
  let servingSyntheticRowsForFallback: FundHistoryRow[] = [];
  let servingInvestorTrendFallback: FundDetailTrendPoint[] = [];
  let servingPortfolioTrendFallback: FundDetailTrendPoint[] = [];
  const historyCandidates: HistorySeriesCandidate[] = [];
  let selectedHistoryCandidate: RankedHistorySeriesCandidate | null = null;
  let selectedTrendCandidate: RankedTrendSeriesCandidate | null = null;
  if (!rescueModeActive) {
    if (DETAIL_HISTORY_SERVING_PRIMARY) {
      try {
        const historyServingRead = await measureStep(steps, "history_serving_read", () =>
          withTimeout(
            getFundDetailCoreServingCached(normalizedCode, { preferFileOnly: true }),
            DETAIL_CORE_SERVING_READ_TIMEOUT_MS,
            "history_serving_read"
          )
        );
        historyServingSource = historyServingRead.source;
        historyServingStalenessMs = Number.isFinite(historyServingRead.ageMs ?? NaN)
          ? Math.max(0, Math.round(historyServingRead.ageMs ?? 0))
          : -1;
        const servingHistory = buildHistoryRowsFromServingPayload(historyServingRead.payload);
        historyServingPoints = servingHistory.pointCount;
        historyServingRange = `${servingHistory.minIso}..${servingHistory.maxIso}`;
        historyDownsampleMode = servingHistory.downsampleMode;
        historyArtifactVersion = servingHistory.artifactVersion != null ? String(servingHistory.artifactVersion) : "none";
        historyArtifactGeneratedAt = servingHistory.artifactGeneratedAt ?? "none";
        historyArtifactSource = servingHistory.artifactSource ?? "none";
        historyServingSnapshotLagDays = coreServingSnapshotLagDays(historyServingRead.payload?.latestSnapshotDate);
        if (
          historyServingSnapshotLagDays != null &&
          historyServingSnapshotLagDays > DETAIL_CORE_SERVING_MAX_SNAPSHOT_LAG_DAYS
        ) {
          historyFallbackUsed = true;
          degradedReasons.add("core_serving_snapshot_stale");
          historyServingSource = "miss";
          historyServingPoints = 0;
          historyServingRange = "none..none";
          historyDownsampleMode = "none";
          servingRowsForFallback = [];
          servingSyntheticRowsForFallback = [];
          servingInvestorTrendFallback = [];
          servingPortfolioTrendFallback = [];
        } else {
          if (historyServingRead.payload) {
            const investorSummarySeries = Array.isArray(historyServingRead.payload.investorSummary?.series)
              ? historyServingRead.payload.investorSummary.series
              : [];
            const portfolioSummarySeries = Array.isArray(historyServingRead.payload.portfolioSummary?.series)
              ? historyServingRead.payload.portfolioSummary.series
              : [];
            servingInvestorTrendFallback = downsampleTimeSeries(
              normalizeTrendSeriesPoints(investorSummarySeries, "investor"),
              DETAIL_TREND_SERIES_MAX_POINTS
            );
            servingPortfolioTrendFallback = downsampleTimeSeries(
              normalizeTrendSeriesPoints(portfolioSummarySeries, "portfolio"),
              DETAIL_TREND_SERIES_MAX_POINTS
            );
          }
          servingRowsForFallback = servingHistory.rowsDesc;
          if (servingHistory.rowsDesc.length >= 2) {
            historyCandidates.push({
              source: "serving_history",
              label: "serving_history",
              rowsDesc: servingHistory.rowsDesc,
              downsampleMode: servingHistory.downsampleMode,
            });
          }
          const servingQuality = evaluateHistorySeriesQuality(
            servingHistory.rowsDesc,
            latestSnapshot.date,
            servingHistory.downsampleMode
          );
          const servingCoverageEnough = servingHistory.coverageDays >= DETAIL_HISTORY_SERVING_MIN_COVERAGE_DAYS;
          const servingPointsEnough = servingHistory.pointCount >= DETAIL_HISTORY_SERVING_MIN_POINTS;
          const servingHistoryTrusted =
            servingRowsForFallback.length >= 2 &&
            servingCoverageEnough &&
            servingPointsEnough &&
            servingQuality.usability === "full";
          if (servingHistoryTrusted) {
            historyRows = servingHistory.rowsDesc;
            historyServingHit = true;
            requestReusedContext = true;
            phase2DuplicatedQueryPrevented += 1;
            priceHistoryRowsCount = servingHistory.rowsDesc.length;
            priceHistoryRawRowsCount = servingHistory.rowsDesc.length;
            priceHistorySelectedFromIso = servingHistory.minIso;
            priceHistorySelectedToIso = servingHistory.maxIso;
            priceHistorySource = "serving";
            priceHistoryQueryPlan = "none";
            priceHistoryColumns = "t,p,d,i,s";
            steps.price_history_query = 0;
            steps.price_history_db_exec_ms = 0;
            steps.price_history_decode_ms = 0;
            steps.price_history_checkout_wait_ms = 0;
            steps.history_live_db_query_ms = 0;
          } else if (servingHistory.rowsDesc.length >= 2 && DETAIL_HISTORY_SERVING_SYNTHETIC_EXTEND) {
            if (!servingCoverageEnough) {
              degradedReasons.add("history_serving_insufficient_coverage");
            }
            if (!servingPointsEnough) {
              degradedReasons.add("history_serving_insufficient_points");
            }
            if (servingHistory.downsampleMode.startsWith("snapshot_compact")) {
              degradedReasons.add("history_serving_sparse_mode");
            }
            if (servingQuality.usability !== "full") {
              degradedReasons.add("history_serving_quality_below_full");
            }
            servingSyntheticRowsForFallback = extendServingHistoryRowsWithSyntheticAnchors(
              servingHistory.rowsDesc,
              {
                date: latestSnapshot.date,
                price: latestSnapshot.lastPrice,
                yearlyReturn: latestSnapshot.yearlyReturn,
              }
            );
            if (servingSyntheticRowsForFallback.length < 2) {
              historyFallbackUsed = true;
              degradedReasons.add("history_serving_synthetic_extension_empty");
            } else {
              historyCandidates.push({
                source: "serving_synthetic",
                label: "serving_synthetic",
                rowsDesc: servingSyntheticRowsForFallback,
                downsampleMode: `${servingHistory.downsampleMode}:synthetic_extend`,
              });
            }
          } else {
            historyFallbackUsed = true;
            if (historyServingRead.payload && !servingCoverageEnough) degradedReasons.add("history_serving_insufficient_coverage");
            if (historyServingRead.payload && !servingPointsEnough) degradedReasons.add("history_serving_insufficient_points");
          }
        }
      } catch (error) {
        historyFallbackUsed = true;
        historyServingSource = "miss";
        historyServingStalenessMs = -1;
        console.warn("[fund-detail] history_serving_read degraded", error);
        failedSteps.push("history_serving_read");
        degradedReasons.add("history_serving_read_failed");
      }
    } else {
      steps.history_serving_read = 0;
      historyFallbackUsed = true;
    }

    if (historyRows.length === 0) {
      historyFallbackUsed = true;
    }

    if (historyRows.length === 0 && DETAIL_HISTORY_LIVE_QUERY_ENABLED) {
      liveHistoryPathAttempted = true;
      try {
        const historyLoad = await measureStep(steps, "price_history_query", () =>
          loadPriceHistoryBySessionLeanCached({
            fundId: phase2Context.fundId,
            fromDate: historyFromDate,
            toDate: phase2Context.snapshotDate,
            limit: DETAIL_HISTORY_FETCH_LIMIT,
          })
        );
        historyRows = historyLoad.rows;
        if (historyLoad.rows.length >= 2) {
          const loadedSource: HistorySeriesCandidateSource =
            historyLoad.source === "snapshot" ? "snapshot_history" : "live_history";
          historyCandidates.push({
            source: loadedSource,
            label: loadedSource,
            rowsDesc: historyLoad.rows,
            downsampleMode: historyLoad.queryPlan,
          });
        }
        priceHistoryCacheHit = historyLoad.cacheHit;
        priceHistoryDeduped = historyLoad.deduped;
        priceHistoryLimitCompatibleCacheHit = historyLoad.limitCompatibleCacheHit;
        priceHistoryLimitCompatibleInFlightHit = historyLoad.limitCompatibleInFlightHit;
        priceHistoryCooldownActive = historyLoad.cooldownActive;
        liveHistoryPathAttempted = historyLoad.liveAttempted ?? liveHistoryPathAttempted;
        priceHistoryFailureCategory = historyLoad.failureCategory ?? "none";
        if (historyLoad.failureCategory && historyLoad.failureCategory !== "none") {
          liveHistoryPathFailed = true;
          liveHistoryPathFailureReason = historyLoad.failureCategory;
          degradedReasons.add("price_history_live_failed_snapshot_fallback");
        }
        priceHistoryRowsCount = historyLoad.rows.length;
        priceHistoryRawRowsCount = historyLoad.rawRows;
        priceHistorySelectedFromIso = historyLoad.selectedFromIso;
        priceHistorySelectedToIso = historyLoad.selectedToIso;
        priceHistorySource = historyLoad.source;
        priceHistoryQueryPlan = historyLoad.queryPlan;
        priceHistoryColumns = historyLoad.columns;
        if (historyLoad.queryPlan === "snapshot_rest_fallback") {
          liveHistoryRestFallbackUsed = true;
        }
        if (historyLoad.cacheHit || historyLoad.deduped) {
          requestReusedContext = true;
        }
        if (historyLoad.dbExecMs != null && !historyLoad.cacheHit && !historyLoad.deduped) {
          steps.price_history_db_exec_ms = Math.round(historyLoad.dbExecMs);
          steps.price_history_decode_ms = Math.max(0, Math.round(historyLoad.decodeMs));
          const checkoutWaitMs = Math.max(
            0,
            Math.round((steps.price_history_query ?? 0) - historyLoad.dbExecMs)
          );
          steps.price_history_checkout_wait_ms = checkoutWaitMs;
          markFirstCheckoutWait("price_history_query", checkoutWaitMs);
        } else if (historyLoad.cacheHit || historyLoad.deduped) {
          steps.price_history_db_exec_ms = 0;
          steps.price_history_decode_ms = 0;
          steps.price_history_checkout_wait_ms = 0;
        } else {
          steps.price_history_db_exec_ms = 0;
          steps.price_history_decode_ms = Math.max(0, Math.round(historyLoad.decodeMs));
          steps.price_history_checkout_wait_ms = 0;
        }
        phase2PrismaCalls += historyLoad.dbQueryCount;
        if (historyLoad.cacheHit || historyLoad.deduped) {
          phase2DuplicatedQueryPrevented += 1;
        }
        if (historyLoad.cooldownActive) {
          degradedReasons.add("price_history_cooldown_active");
          if (historyLoad.rows.length === 0) {
            degradedReasons.add("price_history_cooldown_empty");
          }
        }
        steps.history_live_db_query_ms = steps.price_history_query ?? 0;
      } catch (error) {
        liveHistoryPathFailed = true;
        const classified = classifyDatabaseError(error);
        liveHistoryPathFailureReason = classified.category;
        priceHistoryFailureCategory = classified.category;
        const logLevel = detailEnrichmentDbFailureLogLevel({
          shellUsable: Boolean(latestSnapshot),
          step: "price_history_query",
        });
        console[logLevel](
          `[fund-detail-db-failure] code=${normalizedCode} step=price_history_query phase=${phase} ` +
            `class=${classified.category} prisma_code=${classified.prismaCode ?? "none"} retryable=${classified.retryable ? 1 : 0}`
        );
        console[logLevel]("[fund-detail] price_history failed", error);
        failedSteps.push("price_history_query");
        degradedReasons.add("price_history_query_failed");
        steps.history_live_db_query_ms = steps.price_history_query ?? 0;
      }
      if (historyRows.length === 0 && servingSyntheticRowsForFallback.length >= 2 && DETAIL_HISTORY_SERVING_SYNTHETIC_EXTEND) {
        historyFallbackUsed = true;
        degradedReasons.add("history_serving_synthetic_extension");
      } else if (historyRows.length === 0 && servingRowsForFallback.length >= 2) {
        degradedReasons.add("history_serving_no_live_rows");
      }
    } else if (historyRows.length === 0 && !DETAIL_HISTORY_LIVE_QUERY_ENABLED) {
      historyFallbackUsed = true;
      degradedReasons.add("history_live_query_disabled_serving_only");
      steps.price_history_query = 0;
      steps.history_live_db_query_ms = 0;
    } else {
      steps.history_live_db_query_ms = 0;
    }
  } else {
    steps.price_history_query = 0;
    steps.history_live_db_query_ms = 0;
    steps.history_serving_read = 0;
    degradedReasons.add("rescue_mode_history_skipped");
  }

  if (!rescueModeActive) {
    const rankedHistory = rankHistorySeriesCandidates(historyCandidates, latestSnapshot.date);
    selectedHistoryCandidate = rankedHistory.selected;
    const rankedTrend = rankTrendSeriesCandidates(historyCandidates, latestSnapshot.date);
    selectedTrendCandidate = rankedTrend.selected;
    if (selectedHistoryCandidate) {
      historyRows = selectedHistoryCandidate.candidate.rowsDesc;
      const selectedRange = selectedRangeFromRows(historyRows);
      priceHistoryRowsCount = historyRows.length;
      priceHistoryRawRowsCount = Math.max(priceHistoryRawRowsCount, historyRows.length);
      priceHistorySelectedFromIso = selectedRange.fromIso;
      priceHistorySelectedToIso = selectedRange.toIso;

      if (selectedHistoryCandidate.candidate.source === "live_history") {
        if (priceHistorySource === "none") priceHistorySource = "history";
      } else if (selectedHistoryCandidate.candidate.source === "snapshot_history") {
        requestReusedContext = true;
        phase2DuplicatedQueryPrevented += 1;
        historyServingPoints = historyRows.length;
        historyServingRange = `${selectedRange.fromIso}..${selectedRange.toIso}`;
        historyDownsampleMode = selectedHistoryCandidate.candidate.downsampleMode;
        priceHistorySource = "snapshot";
        priceHistoryQueryPlan = selectedHistoryCandidate.candidate.downsampleMode as typeof priceHistoryQueryPlan;
        priceHistoryColumns = DETAIL_PRICE_HISTORY_COLUMNS;
      } else {
        historyServingHit = true;
        requestReusedContext = true;
        phase2DuplicatedQueryPrevented += 1;
        historyServingPoints = historyRows.length;
        historyServingRange = `${selectedRange.fromIso}..${selectedRange.toIso}`;
        historyDownsampleMode = selectedHistoryCandidate.candidate.downsampleMode;
        priceHistorySource = "serving";
        priceHistoryQueryPlan = "none";
        priceHistoryColumns = "t,p,d,i,s";
      }

      if (selectedHistoryCandidate.quality.usability !== "full") {
        degradedReasons.add("history_series_quality_partial");
      }
      if (selectedHistoryCandidate.candidate.source === "serving_synthetic") {
        degradedReasons.add("history_serving_synthetic_extension");
      }
    } else {
      historyRows = [];
      historyFallbackUsed = true;
      degradedReasons.add("history_series_no_usable_candidate");
    }

    if (shouldLogFundDetailDebug(normalizedCode) && rankedHistory.ranked.length > 0) {
      const selectedSummary = selectedHistoryCandidate
        ? `${selectedHistoryCandidate.candidate.label} points=${selectedHistoryCandidate.quality.pointCount} ` +
          `coverage_days=${selectedHistoryCandidate.quality.coverageDays} gap_ratio_pct=${(
            selectedHistoryCandidate.quality.gapRatio * 100
          ).toFixed(1)} freshness_days=${selectedHistoryCandidate.quality.freshnessDays} ` +
          `usability=${selectedHistoryCandidate.quality.usability} score=${selectedHistoryCandidate.quality.score.toFixed(1)}`
        : "none";
      const rejectedSummary = rankedHistory.ranked
        .filter((entry) => entry !== selectedHistoryCandidate)
        .map((entry) => {
          const reasons: string[] = [];
          if (
            selectedHistoryCandidate &&
            historySeriesUsabilityRank(entry.quality.usability) <
              historySeriesUsabilityRank(selectedHistoryCandidate.quality.usability)
          ) {
            reasons.push("lower_usability");
          }
          if (selectedHistoryCandidate && entry.quality.score < selectedHistoryCandidate.quality.score) {
            reasons.push("lower_score");
          }
          if (entry.quality.pointCount < DETAIL_CHART_PARTIAL_MIN_POINTS) {
            reasons.push("below_partial_points");
          }
          if (entry.candidate.downsampleMode.startsWith("snapshot_compact")) {
            reasons.push("snapshot_compact_mode");
          }
          return (
            `${entry.candidate.label} points=${entry.quality.pointCount} coverage_days=${entry.quality.coverageDays} ` +
            `gap_ratio_pct=${(entry.quality.gapRatio * 100).toFixed(1)} freshness_days=${entry.quality.freshnessDays} ` +
            `usability=${entry.quality.usability} score=${entry.quality.score.toFixed(1)} ` +
            `rejected=${reasons.length > 0 ? reasons.join(",") : "not_selected"}`
          );
        })
        .join(" | ");
      console.info(
        `[fund-detail-series-selection] code=${normalizedCode} selected=${selectedSummary} ` +
          `rejected=${rejectedSummary || "none"}`
      );
      const selectedTrendSummary = selectedTrendCandidate
        ? `${selectedTrendCandidate.candidate.label} investor_points=${selectedTrendCandidate.quality.investor.pointCount} ` +
          `investor_state=${selectedTrendCandidate.quality.investor.state} portfolio_points=${selectedTrendCandidate.quality.portfolio.pointCount} ` +
          `portfolio_state=${selectedTrendCandidate.quality.portfolio.state} state=${selectedTrendCandidate.quality.state} ` +
          `score=${selectedTrendCandidate.quality.score.toFixed(1)}`
        : "none";
      const rejectedTrendSummary = rankedTrend.ranked
        .filter((entry) => entry !== selectedTrendCandidate)
        .map((entry) => {
          const reasons: string[] = [];
          if (
            selectedTrendCandidate &&
            renderableSeriesRank(entry.quality.state) < renderableSeriesRank(selectedTrendCandidate.quality.state)
          ) {
            reasons.push("lower_state");
          }
          if (selectedTrendCandidate && entry.quality.score < selectedTrendCandidate.quality.score) {
            reasons.push("lower_score");
          }
          if (entry.quality.investor.pointCount < 2) reasons.push("investor_insufficient");
          if (entry.quality.portfolio.pointCount < 2) reasons.push("portfolio_insufficient");
          return (
            `${entry.candidate.label} investor_points=${entry.quality.investor.pointCount} ` +
            `portfolio_points=${entry.quality.portfolio.pointCount} state=${entry.quality.state} ` +
            `score=${entry.quality.score.toFixed(1)} rejected=${reasons.join(",") || "not_selected"}`
          );
        })
        .join(" | ");
      console.info(
        `[fund-detail-main-series] code=${normalizedCode} selected=${selectedSummary} selected_trend=${selectedTrendSummary} ` +
          `rejected=${rejectedSummary || "none"} rejected_trend=${rejectedTrendSummary || "none"}`
      );
    }
  }

  let historyBoundsDebug:
    | {
        minDate: Date | null;
        maxDate: Date | null;
        totalRows: number;
        sessionDays: number;
      }
    | null = null;
  if (shouldLogFundDetailDebug(normalizedCode) && !rescueModeActive) {
    if (DETAIL_DEBUG_HISTORY_BOUNDS_DB) {
      try {
        phase2PrismaCalls += 1;
        historyBoundsDebug = await measureStep(steps, "price_history_bounds_query", () =>
          loadPriceHistoryBounds(phase2Context.fundId)
        );
      } catch (error) {
        console.error("[fund-detail] price_history_bounds_query failed", error);
        failedSteps.push("price_history_bounds_query");
      }
    } else {
      phase2DuplicatedQueryPrevented += 1;
      let minTs = Number.POSITIVE_INFINITY;
      let maxTs = Number.NEGATIVE_INFINITY;
      const sessions = new Set<number>();
      for (const row of historyRows) {
        const sessionTs = normalizeHistorySessionDate(row.date).getTime();
        sessions.add(sessionTs);
        if (sessionTs < minTs) minTs = sessionTs;
        if (sessionTs > maxTs) maxTs = sessionTs;
      }
      historyBoundsDebug = {
        minDate: Number.isFinite(minTs) ? new Date(minTs) : null,
        maxDate: Number.isFinite(maxTs) ? new Date(maxTs) : null,
        totalRows: historyRows.length,
        sessionDays: sessions.size,
      };
      steps.price_history_bounds_query = 0;
    }
  } else {
    steps.price_history_bounds_query = 0;
  }

  let derivedMetrics: DerivedMetricsRow | null = null;
  if (!rescueModeActive) {
    try {
      let derivedMetricsMs = 0;
      let coreFundMs = 0;
      const bundled = await measureStep(steps, "core_meta_bundle_query", () =>
        prisma.$transaction(
          async (tx) => {
            const derivedStartedAt = Date.now();
            const derived = await tx.fundDerivedMetrics.findUnique({
              where: { fundId: phase2Context.fundId },
              select: {
                return30d: true,
                return90d: true,
                return180d: true,
                return1y: true,
                return2y: true,
                volatility1y: true,
                maxDrawdown1y: true,
                annualizedReturn1y: true,
                sharpe1y: true,
                sortino1y: true,
                totalReturn2y: true,
                historySessions: true,
              },
            });
            derivedMetricsMs = Date.now() - derivedStartedAt;

            const fundStartedAt = Date.now();
            const fund = await tx.fund.findUnique({
              where: { id: latestSnapshot.fundId },
              select: {
                id: true,
                categoryId: true,
                description: true,
                weeklyReturn: true,
                lastUpdatedAt: true,
                updatedAt: true,
              },
            });
            coreFundMs = Date.now() - fundStartedAt;
            return { derived, fund };
          },
          { maxWait: 8_000, timeout: 12_000 }
        )
      );
      derivedMetrics = bundled.derived;
      fundCore = bundled.fund;
      phase2Context.categoryId = fundCore?.categoryId ?? null;
      phase2PrismaCalls += 2;
      steps.derived_metrics_query = derivedMetricsMs;
      steps.core_fund_query = coreFundMs;
      steps.core_meta_bundle_checkout_wait_ms = Math.max(
        0,
        (steps.core_meta_bundle_query ?? 0) - (derivedMetricsMs + coreFundMs)
      );
    } catch (error) {
      const classified = classifyDatabaseError(error);
      const logLevel = detailEnrichmentDbFailureLogLevel({
        shellUsable: Boolean(latestSnapshot),
        step: "core_meta_bundle_query",
      });
      console[logLevel](
        `[fund-detail-db-failure] code=${normalizedCode} step=core_meta_bundle_query phase=${phase} ` +
          `class=${classified.category} prisma_code=${classified.prismaCode ?? "none"} retryable=${classified.retryable ? 1 : 0}`
      );
      console[logLevel]("[fund-detail] core_meta_bundle_query failed", error);
      failedSteps.push("core_meta_bundle_query");
      degradedReasons.add("core_meta_bundle_query_failed");
      steps.derived_metrics_query = steps.derived_metrics_query ?? 0;
      steps.core_fund_query = steps.core_fund_query ?? 0;
    }
  } else {
    steps.derived_metrics_query = 0;
    steps.core_fund_query = 0;
    steps.core_meta_bundle_query = 0;
  }
  if (!fundCore) degradedReasons.add("core_fund_missing");

  const priceHistoryPostprocessStartedAt = Date.now();
  const historyAssembly = buildHistoryAssembliesFromDescRows(historyRows);
  const ascHistory = historyAssembly.ascHistory;
  const historyPoints = historyAssembly.historyPoints;
  steps.price_history_postprocess_ms = Date.now() - priceHistoryPostprocessStartedAt;
  const fallbackSeriesStartedAt = Date.now();
  const sparklinePoints = historyPoints.length >= 2 ? [] : buildSparklinePricePoints(latestSnapshot.date, latestSnapshot.sparkline);
  const approxPoints = historyPoints.length >= 2 || sparklinePoints.length >= 2
    ? []
    : buildApproxPricePointsFromReturns(
        latestSnapshot.date,
        latestSnapshot.lastPrice,
        latestSnapshot.monthlyReturn,
        latestSnapshot.yearlyReturn
      );
  steps.fallback_snapshot_series_generation = Date.now() - fallbackSeriesStartedAt;

  const points =
    historyPoints.length >= 2
      ? historyPoints
      : sparklinePoints.length >= 2
        ? sparklinePoints
        : approxPoints;
  const performanceSeriesSource: "history" | "snapshot_fallback" | "approx" =
    historyPoints.length >= 2 ? "history" : sparklinePoints.length >= 2 ? "snapshot_fallback" : "approx";
  if (historyPoints.length < 2) {
    degradedReasons.add("history_fallback_series_used");
  }
  degradedReasons.add(`core_price_series_source_${performanceSeriesSource}`);
  if (shouldLogFundDetailDebug(normalizedCode)) {
    const pointMinDate = points[0]?.date ?? null;
    const pointMaxDate = points[points.length - 1]?.date ?? null;
    const requestedFromIso = historyFromDate.toISOString();
    const requestedToIso = latestSnapshot.date.toISOString();
    const longHistoryExists =
      historyBoundsDebug?.minDate != null &&
      historyBoundsDebug.minDate.getTime() <= latestSnapshot.date.getTime() - 1000 * DAY_MS;
    const longHistoryIgnored =
      Boolean(longHistoryExists) && pointMinDate != null && pointMinDate.getTime() > latestSnapshot.date.getTime() - 1000 * DAY_MS;
    console.info(
      `[fund-detail-history-window] code=${normalizedCode} requested_window=${requestedFromIso}..${requestedToIso} ` +
        `source_used=${performanceSeriesSource} points=${points.length} min_date=${pointMinDate?.toISOString() ?? "none"} ` +
        `max_date=${pointMaxDate?.toISOString() ?? "none"} fallback_used=${performanceSeriesSource !== "history" ? 1 : 0} ` +
        `phase=${phase} full_history_min=${historyBoundsDebug?.minDate?.toISOString() ?? "none"} ` +
        `full_history_max=${historyBoundsDebug?.maxDate?.toISOString() ?? "none"} full_history_rows=${historyBoundsDebug?.totalRows ?? 0} ` +
        `full_history_session_days=${historyBoundsDebug?.sessionDays ?? 0} long_history_exists=${longHistoryExists ? 1 : 0} ` +
        `long_history_ignored=${longHistoryIgnored ? 1 : 0}`
    );
  }
  const priceSeries: FundDetailPricePoint[] = downsampleTimeSeries(points, DETAIL_PRICE_SERIES_MAX_POINTS).map((point) => ({
    t: point.date.getTime(),
    p: point.price,
  }));
  const payloadMinIso = points[0]?.date.toISOString() ?? "none";
  const payloadMaxIso = points[points.length - 1]?.date.toISOString() ?? "none";
  const renderedMinIso = priceSeries[0] ? new Date(priceSeries[0].t).toISOString() : "none";
  const renderedMaxIso = priceSeries[priceSeries.length - 1]
    ? new Date(priceSeries[priceSeries.length - 1]!.t).toISOString()
    : "none";
  console.info(
    `[detail-history-payload] code=${normalizedCode} detail_history_payload_min_date=${payloadMinIso} ` +
      `detail_history_payload_max_date=${payloadMaxIso} detail_history_rendered_points=${priceSeries.length} ` +
      `detail_history_rendered_min_date=${renderedMinIso} detail_history_rendered_max_date=${renderedMaxIso} ` +
      `detail_history_source=${performanceSeriesSource} detail_history_short_fallback_used=${performanceSeriesSource !== "history" ? 1 : 0}`
  );

  const historyMetrics = derivedMetrics ? toHistoryMetricsFromDerived(derivedMetrics) : reliableHistoryMetrics(points);
  const bestWorstDay =
    ascHistory.length > 0 ? bestWorstDailyReturn(ascHistory.map((row) => ({ dailyReturn: row.dailyReturn }))) : null;
  const snapshotMetrics = parseFundMetricsJson(latestSnapshot.metrics);
  const categoryCode = latestSnapshot.categoryCode ?? "";
  const riskLevel = parseRiskLevel(latestSnapshot.riskLevel) ?? determineRiskLevel(categoryCode, latestSnapshot.name);

  const fundTypeResolved =
    latestSnapshot.fundTypeCode != null && latestSnapshot.fundTypeName
      ? {
          code: latestSnapshot.fundTypeCode,
          name: fundTypeDisplayLabel({
            code: latestSnapshot.fundTypeCode,
            name: latestSnapshot.fundTypeName,
          }),
        }
      : null;

  const rolling = bestWorstRollingTradingWindow(points, ROLLING_TRADING_DAYS);
  const derivedSummary: FundDetailDerivedSummary = {
    returnApprox1YearPct: derivedMetrics?.return1y ?? returnApproxCalendarDays(points, 365),
    returnApprox2YearPct: derivedMetrics?.return2y ?? returnApproxCalendarDays(points, 730),
    returnApprox3YearPct: returnApproxCalendarDays(points, 1095),
    bestRollingMonthPct: rolling?.bestPct ?? null,
    worstRollingMonthPct: rolling?.worstPct ?? null,
  };

  const benchCode = categoryCode ? getBenchmarkForCategory(categoryCode) : null;
  const modelBenchmark = benchCode ? { code: benchCode, label: getBenchmarkName(benchCode) } : null;

  let similarSnapshotRows: Array<{
    fundId: string;
    code: string;
    name: string;
    shortName: string | null;
    lastPrice: number;
    dailyReturn: number;
    logoUrl: string | null;
    portfolioSize: number;
    investorCount: number;
    monthlyReturn: number;
    yearlyReturn: number;
  }> = [];
  let alternativesSource:
    | "snapshot_query"
    | "fund_rescue_query"
    | "serving_file"
    | "serving_memory"
    | "funds_list"
    | "cache_seed"
    | "none" = "none";
  let alternativesFallbackUsed = false;
  let alternativesDegradedReason = "none";
  const optionalSectionsEnabled = !rescueModeActive && (phase === "phase2" || !DETAIL_DEFER_OPTIONAL_SECTIONS);
  const optionalStartedAt = Date.now();
  const phase2CoreElapsedMs = phase === "phase2" ? Math.max(0, optionalStartedAt - startedAt) : 0;
  const phase2AdaptiveOptionalBudgetMs =
    phase === "phase2"
      ? Math.max(
          0,
          Math.min(
            DETAIL_PHASE2_OPTIONAL_BUDGET_MS,
            DETAIL_PHASE2_TARGET_MS - phase2CoreElapsedMs
          )
        )
      : Number.MAX_SAFE_INTEGER;
  const optionalBudgetMs = phase === "phase2" ? phase2AdaptiveOptionalBudgetMs : Number.MAX_SAFE_INTEGER;
  const optionalKiyasReserveMs =
    phase === "phase2"
      ? Math.max(
          DETAIL_PHASE2_OPTIONAL_MIN_STEP_BUDGET_MS,
          Math.min(DETAIL_OPTIONAL_KIYAS_TIMEOUT_MS, Math.round(optionalBudgetMs * 0.55))
        )
      : 0;
  const optionalRemainingMs = () => Math.max(0, optionalBudgetMs - (Date.now() - optionalStartedAt));
  const hasOptionalBudget = (reserveForKiyas = false) =>
    optionalRemainingMs() >=
    DETAIL_PHASE2_OPTIONAL_MIN_STEP_BUDGET_MS + (reserveForKiyas ? optionalKiyasReserveMs : 0);
  const optionalStepTimeoutMs = (reserveForKiyas = false) =>
    Math.max(
      DETAIL_PHASE2_OPTIONAL_MIN_STEP_BUDGET_MS,
      Math.min(
        DETAIL_OPTIONAL_KIYAS_TIMEOUT_MS,
        Math.max(
          DETAIL_PHASE2_OPTIONAL_MIN_STEP_BUDGET_MS,
          optionalRemainingMs() - (reserveForKiyas ? optionalKiyasReserveMs : 0)
        )
      )
    );
  let kiyasBlock: FundKiyasViewPayload | null = null;
  let kiyasAttempted = false;
  let comparisonPathFailureReason = "none";
  let comparisonPathSkippedReason = "none";
  let comparisonPathTimeoutMs = 0;
  const runOptionalKiyasBlock = async (): Promise<void> => {
    kiyasAttempted = true;
    const kiyasTimeoutMs =
      phase === "phase2"
        ? DETAIL_COMPARISON_CORE_TIMEOUT_MS
        : Math.max(
            DETAIL_PHASE2_OPTIONAL_MIN_STEP_BUDGET_MS,
            Math.min(DETAIL_OPTIONAL_KIYAS_TIMEOUT_MS, optionalRemainingMs())
          );
    comparisonPathTimeoutMs = kiyasTimeoutMs;
    const kiyasTelemetry = { queryCount: 0, cacheHitCount: 0, dedupedCount: 0 };
    kiyasBlock = await measureStep(steps, "optional_kiyas_block_query", () =>
      withTimeout(
        buildFundKiyasBlock(
          {
            fundId: latestSnapshot.fundId,
            categoryId: phase2Context.categoryId,
            categoryCode: phase2Context.categoryCode,
            fundName: latestSnapshot.name,
            fundTypeCode: latestSnapshot.fundTypeCode,
            anchorDate: phase2Context.snapshotDate,
            derived: derivedMetrics
              ? {
                  return30d: derivedMetrics.return30d,
                  return90d: derivedMetrics.return90d,
                  return180d: derivedMetrics.return180d,
                  return1y: derivedMetrics.return1y,
                  return2y: derivedMetrics.return2y,
                  return3y: null,
                }
              : null,
            pricePoints: points,
          },
          { telemetry: kiyasTelemetry }
        ),
        kiyasTimeoutMs,
        "optional_kiyas_block_query"
      )
    );
    if (!kiyasBlock) {
      comparisonPathSkippedReason = "no_refs_generated";
    }
    phase2KiyasDbCalls = kiyasTelemetry.queryCount;
    phase2PrismaCalls += kiyasTelemetry.queryCount;
    phase2DuplicatedQueryPrevented += kiyasTelemetry.cacheHitCount + kiyasTelemetry.dedupedCount;
  };

  if (optionalSectionsEnabled) {
    try {
      await runOptionalKiyasBlock();
    } catch (error) {
      console.warn("[fund-detail] kiyas_block failed", error);
      failedSteps.push("optional_kiyas_block_query");
      degradedReasons.add("optional_kiyas_block_failed");
      const message = error instanceof Error ? error.message : String(error);
      comparisonPathFailureReason = message || "unknown_error";
      if (message.includes("optional_kiyas_block_query_timeout_")) {
        phase2KiyasTimedOut = true;
        comparisonPathSkippedReason = "timeout";
      } else {
        comparisonPathSkippedReason = "query_failed";
      }
    }
  } else {
    steps.optional_kiyas_block_query = 0;
    comparisonPathSkippedReason = "optional_sections_disabled";
  }

  if (optionalSectionsEnabled && phase2Context.categoryCode && hasOptionalBudget(true)) {
    try {
      const relatedTimeoutMs = optionalStepTimeoutMs(true);
      phase2PrismaCalls += 1;
      similarSnapshotRows = await measureStep(steps, "optional_related_funds_query", () =>
        withTimeout(
          prisma.fundDailySnapshot.findMany({
            where: {
              date: latestSnapshot.date,
              categoryCode: phase2Context.categoryCode,
              fundId: { not: phase2Context.fundId },
            },
            orderBy: { portfolioSize: "desc" },
            take: FUND_ALTERNATIVES_CANDIDATE_POOL,
            select: {
              fundId: true,
              code: true,
              name: true,
              shortName: true,
              lastPrice: true,
              dailyReturn: true,
              logoUrl: true,
              portfolioSize: true,
              investorCount: true,
              monthlyReturn: true,
              yearlyReturn: true,
            },
          }),
          relatedTimeoutMs,
          "optional_related_funds_query"
        )
      );
      if (similarSnapshotRows.length > 0) {
        alternativesSource = "snapshot_query";
      }
    } catch (error) {
      console.warn("[fund-detail] related_funds failed", error);
      failedSteps.push("optional_related_funds_query");
      degradedReasons.add("optional_related_funds_failed");
      alternativesDegradedReason = "optional_related_funds_failed";
    }
  } else {
    steps.optional_related_funds_query = 0;
    if (!optionalSectionsEnabled && DETAIL_DEFER_OPTIONAL_SECTIONS) {
      degradedReasons.add("phase2_optional_sections_deferred");
    }
    if (rescueModeActive) degradedReasons.add("rescue_mode_optional_sections_skipped");
    if (optionalSectionsEnabled && phase2Context.categoryCode && !hasOptionalBudget(true)) {
      degradedReasons.add("phase2_optional_budget_exhausted_related");
    }
  }

  let categoryReturnAverages: FundCategoryReturnAverages | null = null;
  if (optionalSectionsEnabled && ENABLE_EAGER_DETAIL_SECONDARY && hasOptionalBudget(true)) {
    try {
      const categoryTimeoutMs = optionalStepTimeoutMs(true);
      phase2PrismaCalls += 1;
      categoryReturnAverages = await measureStep(steps, "optional_category_averages_query", () =>
        withTimeout(
          loadCategoryReturnAverages(
            latestSnapshot.fundId,
            phase2Context.categoryCode,
            phase2Context.snapshotDate
          ),
          categoryTimeoutMs,
          "optional_category_averages_query"
        )
      );
    } catch (error) {
      console.warn("[fund-detail] category_averages failed", error);
      failedSteps.push("optional_category_averages_query");
      degradedReasons.add("optional_category_averages_failed");
    }
  } else {
    steps.optional_category_averages_query = 0;
    if (optionalSectionsEnabled && ENABLE_EAGER_DETAIL_SECONDARY && !hasOptionalBudget(true)) {
      degradedReasons.add("phase2_optional_budget_exhausted_category_averages");
    }
  }

  if (optionalSectionsEnabled && similarSnapshotRows.length === 0 && phase2Context.categoryId && hasOptionalBudget(true)) {
    try {
      const rescueTimeoutMs = optionalStepTimeoutMs(false);
      phase2PrismaCalls += 1;
      const rescueRows = await measureStep(steps, "optional_related_funds_rescue_query", () =>
        withTimeout(
          prisma.fund.findMany({
            where: {
              categoryId: phase2Context.categoryId,
              id: { not: phase2Context.fundId },
              isActive: true,
            },
            orderBy: { portfolioSize: "desc" },
            take: FUND_ALTERNATIVES_CANDIDATE_POOL,
            select: {
              id: true,
              code: true,
              name: true,
              shortName: true,
              logoUrl: true,
              lastPrice: true,
              dailyReturn: true,
              portfolioSize: true,
              investorCount: true,
              monthlyReturn: true,
              yearlyReturn: true,
            },
          }),
          rescueTimeoutMs,
          "optional_related_funds_rescue_query"
        )
      );
      similarSnapshotRows = rescueRows.map((row) => ({
        fundId: row.id,
        code: row.code,
        name: row.name,
        shortName: row.shortName,
        lastPrice: row.lastPrice,
        dailyReturn: row.dailyReturn,
        logoUrl: row.logoUrl,
        portfolioSize: row.portfolioSize,
        investorCount: row.investorCount,
        monthlyReturn: row.monthlyReturn,
        yearlyReturn: row.yearlyReturn,
      }));
      if (similarSnapshotRows.length > 0) {
        alternativesSource = "fund_rescue_query";
      }
    } catch (error) {
      console.error("[fund-detail] related_funds_rescue failed", error);
      failedSteps.push("optional_related_funds_rescue_query");
      degradedReasons.add("optional_related_funds_rescue_failed");
      alternativesDegradedReason = "optional_related_funds_rescue_failed";
    }
  } else {
    steps.optional_related_funds_rescue_query = 0;
    if (optionalSectionsEnabled && similarSnapshotRows.length === 0 && phase2Context.categoryId && !hasOptionalBudget(true)) {
      degradedReasons.add("phase2_optional_budget_exhausted_related_rescue");
    }
  }

  if (similarSnapshotRows.length === 0) {
    const servingAlternatives = await listFundDetailCoreServingAlternatives(
      normalizedCode,
      FUND_ALTERNATIVES_CANDIDATE_POOL
    );
    if (servingAlternatives.rows.length > 0) {
      similarSnapshotRows = servingAlternatives.rows.map((row) => ({
        fundId: row.fundId,
        code: row.code,
        name: row.name,
        shortName: row.shortName,
        lastPrice: row.lastPrice,
        dailyReturn: row.dailyReturn,
        logoUrl: row.logoUrl,
        portfolioSize: row.portfolioSize,
        investorCount: row.investorCount,
        monthlyReturn: row.monthlyReturn,
        yearlyReturn: row.yearlyReturn,
      }));
      alternativesSource = servingAlternatives.source === "memory" ? "serving_memory" : "serving_file";
      alternativesFallbackUsed = true;
      alternativesDegradedReason = "serving_fallback";
    } else if (alternativesDegradedReason === "none") {
      alternativesDegradedReason = servingAlternatives.missReason ?? "serving_fallback_empty";
    }
  }

  if (similarSnapshotRows.length === 0) {
    const fundsListCandidates = await listFundDetailFundsListAlternatives(
      normalizedCode,
      phase2Context.categoryCode,
      FUND_ALTERNATIVES_CANDIDATE_POOL
    );
    if (fundsListCandidates.length > 0) {
      similarSnapshotRows = fundsListCandidates.map((row) => ({
        fundId: row.code,
        code: row.code,
        name: row.name,
        shortName: row.shortName,
        lastPrice: row.lastPrice,
        dailyReturn: row.dailyReturn,
        logoUrl: row.logoUrl,
        portfolioSize: row.portfolioSize,
        investorCount: row.investorCount,
        monthlyReturn: row.monthlyReturn,
        yearlyReturn: row.yearlyReturn,
      }));
      alternativesSource = "funds_list";
      alternativesFallbackUsed = true;
      alternativesDegradedReason = "funds_list_fallback";
    }
  }

  const similarCandidates: FundAlternativeCandidate[] = similarSnapshotRows.map((row) => ({
    code: row.code,
    name: row.name,
    shortName: row.shortName,
    lastPrice: row.lastPrice,
    dailyReturn: row.dailyReturn,
    logoUrl: getFundLogoUrlForUi(row.fundId, row.code, row.logoUrl, row.name),
    portfolioSize: row.portfolioSize,
    investorCount: row.investorCount,
    monthlyReturn: row.monthlyReturn,
    yearlyReturn: row.yearlyReturn,
  }));
  const seedAlternatives = options?.alternativesSeed ?? [];
  const builtSimilarFunds = buildFundAlternatives(
    {
      portfolioSize: latestSnapshot.portfolioSize,
      investorCount: latestSnapshot.investorCount,
      dailyReturn: latestSnapshot.dailyReturn,
      monthlyReturn: latestSnapshot.monthlyReturn,
      yearlyReturn: latestSnapshot.yearlyReturn,
    },
    similarCandidates
  );
  const similarFunds =
    builtSimilarFunds.length > 0
      ? builtSimilarFunds
      : seedAlternatives.length > 0
        ? seedAlternatives
        : builtSimilarFunds;
  if (builtSimilarFunds.length === 0 && seedAlternatives.length > 0) {
    alternativesSource = "cache_seed";
    alternativesFallbackUsed = true;
    alternativesDegradedReason = "cache_seed";
  }

  const trendRowsForPrimarySource =
    selectedTrendCandidate?.candidate.rowsDesc && selectedTrendCandidate.candidate.rowsDesc.length >= 2
      ? [...selectedTrendCandidate.candidate.rowsDesc].reverse()
      : ascHistory;
  const trendSeriesFromHistory = rescueModeActive
    ? { portfolioSize: [], investorCount: [] }
    : buildTrendSeries(trendRowsForPrimarySource);
  const normalizedInvestorFromHistory = downsampleTimeSeries(
    normalizeTrendSeriesPoints(trendSeriesFromHistory.investorCount, "investor"),
    DETAIL_TREND_SERIES_MAX_POINTS
  );
  const normalizedPortfolioFromHistory = downsampleTimeSeries(
    normalizeTrendSeriesPoints(trendSeriesFromHistory.portfolioSize, "portfolio"),
    DETAIL_TREND_SERIES_MAX_POINTS
  );
  const trendSeries = rescueModeActive
    ? { portfolioSize: [], investorCount: [] }
    : {
        investorCount:
          normalizedInvestorFromHistory.length >= 2 ? normalizedInvestorFromHistory : servingInvestorTrendFallback,
        portfolioSize:
          normalizedPortfolioFromHistory.length >= 2 ? normalizedPortfolioFromHistory : servingPortfolioTrendFallback,
      };

  const fullPayloadBuildStartedAt = Date.now();
  const effectiveLastUpdatedAt =
    fundCore?.lastUpdatedAt && fundCore.lastUpdatedAt.getTime() >= latestSnapshot.date.getTime()
      ? fundCore.lastUpdatedAt
      : latestSnapshot.date;
  let payload: FundDetailPageData = {
    fund: {
      code: latestSnapshot.code,
      name: latestSnapshot.name,
      shortName: latestSnapshot.shortName,
      description: fundCore?.description ?? null,
      lastPrice: latestSnapshot.lastPrice,
      dailyReturn: latestSnapshot.dailyReturn,
      weeklyReturn: fundCore?.weeklyReturn ?? 0,
      monthlyReturn: latestSnapshot.monthlyReturn,
      yearlyReturn: latestSnapshot.yearlyReturn,
      portfolioSize: latestSnapshot.portfolioSize,
      investorCount: latestSnapshot.investorCount,
      category:
        latestSnapshot.categoryCode && latestSnapshot.categoryName
          ? { code: latestSnapshot.categoryCode, name: latestSnapshot.categoryName }
          : null,
      fundType: fundTypeResolved,
      logoUrl: getFundLogoUrlForUi(
        latestSnapshot.fundId,
        latestSnapshot.code,
        latestSnapshot.logoUrl,
        latestSnapshot.name
      ),
      lastUpdatedAt: effectiveLastUpdatedAt.toISOString(),
      updatedAt: fundCore?.updatedAt ? fundCore.updatedAt.toISOString() : latestSnapshot.date.toISOString(),
      portfolioManagerInferred: null,
    },
    snapshotDate: latestSnapshot.date.toISOString(),
    snapshotAlpha: Number.isFinite(latestSnapshot.alpha) ? latestSnapshot.alpha : null,
    riskLevel,
    snapshotMetrics,
    priceSeries,
    historyMetrics,
    bestWorstDay,
    modelBenchmark,
    tradingCurrency: "TRY",
    derivedSummary,
    similarFunds,
    similarCategoryPeerDailyReturns: similarCandidates
      .map((row) => row.dailyReturn)
      .filter((x) => Number.isFinite(x)),
    categoryReturnAverages,
    kiyasBlock,
    trendSeries,
  };

  const sectionStates = deriveFundDetailSectionStates(payload);
  if (sectionStates.performance !== "full") {
    degradedReasons.add("history_series_quality_partial");
  }
  if (sectionStates.trends !== "full") {
    degradedReasons.add("trend_series_quality_partial");
  }
  if (sectionStates.comparison === "no_data" && !kiyasBlock) {
    degradedReasons.add(phase2KiyasTimedOut ? "optional_kiyas_block_missing_timeout_or_budget" : "optional_kiyas_block_missing");
  }

  const partial =
    failedSteps.length > 0 ||
    rescueModeActive ||
    historyPoints.length < 2 ||
    !fundCore ||
    sectionStates.performance !== "full" ||
    sectionStates.trends !== "full" ||
    (sectionStates.comparison === "no_data" && !kiyasBlock);
  if (partial) {
    payload = withDegradedPayload(payload, {
      stale: false,
      partial: true,
      reasons: [...degradedReasons],
      failedSteps,
    });
  }
  steps.full_payload_build = Date.now() - fullPayloadBuildStartedAt;

  const totalMs = Date.now() - startedAt;
  steps.total_route_duration = totalMs;
  const slowestStep = Object.entries(steps).reduce<{ name: string; ms: number }>(
    (acc, [name, ms]) => (ms > acc.ms ? { name, ms } : acc),
    { name: "none", ms: 0 }
  );
  const comparisonValidRefs = countValidComparisonRefs(payload.kiyasBlock);
  const comparisonRows1y = payload.kiyasBlock
    ? Object.values(payload.kiyasBlock.rowsByRef).reduce(
        (sum, rows) => sum + rows.filter((row) => row.periodId === "1y").length,
        0
      )
    : 0;
  const comparisonTotalRefs = payload.kiyasBlock?.refs.length ?? 0;
  const investorTrendQuality = evaluateTrendSeriesQuality(payload.trendSeries.investorCount, latestSnapshot.date);
  const portfolioTrendQuality = evaluateTrendSeriesQuality(payload.trendSeries.portfolioSize, latestSnapshot.date);
  if (shouldLogFundDetailDebug(normalizedCode)) {
    const trendSourceLabel = selectedTrendCandidate?.candidate.label ?? "price_selected_history";
    const selectedHistoryLabel = selectedHistoryCandidate?.candidate.label ?? "none";
    const selectedHistoryRawPoints = selectedHistoryCandidate?.candidate.rowsDesc.length ?? 0;
    const selectedTrendInvestorRawPoints =
      selectedTrendCandidate?.candidate.rowsDesc.filter((row) => Number.isFinite(row.investorCount)).length ?? 0;
    const selectedTrendPortfolioRawPoints =
      selectedTrendCandidate?.candidate.rowsDesc.filter((row) => Number.isFinite(row.portfolioSize)).length ?? 0;
    const investorUsedFallback = normalizedInvestorFromHistory.length >= 2 ? 0 : payload.trendSeries.investorCount.length >= 2 ? 1 : 0;
    const aumUsedFallback = normalizedPortfolioFromHistory.length >= 2 ? 0 : payload.trendSeries.portfolioSize.length >= 2 ? 1 : 0;
    console.info(
      `[fund-detail-main-source-path] code=${normalizedCode} selected_source=${selectedHistoryLabel} ` +
        `raw_points=${selectedHistoryRawPoints} normalized_points=${payload.priceSeries.length} ` +
        `date_span=${payloadMinIso}..${payloadMaxIso} db_live_attempted=${liveHistoryPathAttempted ? 1 : 0} ` +
        `db_live_failed=${liveHistoryPathFailed ? 1 : 0} db_live_failure_reason=${liveHistoryPathFailureReason} ` +
        `rest_fallback_used=${liveHistoryRestFallbackUsed ? 1 : 0} serving_source=${historyServingSource} ` +
        `serving_points=${historyServingPoints} fallback_used=${historyFallbackUsed ? 1 : 0} ` +
        `query_plan=${priceHistoryQueryPlan} source=${priceHistorySource} selected_mode=${historyDownsampleMode} ` +
        `artifact_version=${historyArtifactVersion} artifact_generated_at=${historyArtifactGeneratedAt} ` +
        `artifact_source=${historyArtifactSource}`
    );
    console.info(
      `[fund-detail-investor-source-path] code=${normalizedCode} selected_source=${trendSourceLabel} ` +
        `raw_points=${selectedTrendInvestorRawPoints} normalized_points=${payload.trendSeries.investorCount.length} ` +
        `fallback_points=${servingInvestorTrendFallback.length} used_fallback=${investorUsedFallback}`
    );
    console.info(
      `[fund-detail-aum-source-path] code=${normalizedCode} selected_source=${trendSourceLabel} ` +
        `raw_points=${selectedTrendPortfolioRawPoints} normalized_points=${payload.trendSeries.portfolioSize.length} ` +
        `fallback_points=${servingPortfolioTrendFallback.length} used_fallback=${aumUsedFallback}`
    );
    console.info(
      `[fund-detail-investor-history] code=${normalizedCode} source=${trendSourceLabel} raw_points=${trendSeriesFromHistory.investorCount.length} ` +
        `normalized_points=${payload.trendSeries.investorCount.length} range=${investorTrendQuality.minIso}..${investorTrendQuality.maxIso} ` +
        `coverage_days=${investorTrendQuality.coverageDays} gap_ratio_pct=${(investorTrendQuality.gapRatio * 100).toFixed(1)} ` +
        `freshness_days=${investorTrendQuality.freshnessDays} state=${investorTrendQuality.state}`
    );
    console.info(
      `[fund-detail-aum-history] code=${normalizedCode} source=${trendSourceLabel} raw_points=${trendSeriesFromHistory.portfolioSize.length} ` +
        `normalized_points=${payload.trendSeries.portfolioSize.length} range=${portfolioTrendQuality.minIso}..${portfolioTrendQuality.maxIso} ` +
        `coverage_days=${portfolioTrendQuality.coverageDays} gap_ratio_pct=${(portfolioTrendQuality.gapRatio * 100).toFixed(1)} ` +
        `freshness_days=${portfolioTrendQuality.freshnessDays} state=${portfolioTrendQuality.state}`
    );
    console.info(
      `[fund-detail-comparison-source-path] code=${normalizedCode} attempted=${kiyasAttempted ? 1 : 0} ` +
        `timeout_budget_ms=${comparisonPathTimeoutMs} source=${kiyasBlock ? "kiyas_block" : "none"} ` +
        `failed_reason=${comparisonPathFailureReason} skipped_reason=${comparisonPathSkippedReason} ` +
        `valid_refs=${comparisonValidRefs}/${comparisonTotalRefs}`
    );
    console.info(
      `[fund-detail-comparison] code=${normalizedCode} valid_refs=${comparisonValidRefs} total_refs=${comparisonTotalRefs} ` +
        `rows_1y=${comparisonRows1y} section_state=${sectionStates.comparison} source=${kiyasBlock ? "kiyas_block" : "none"} ` +
        `dropped_reason=${phase2KiyasTimedOut ? "timeout_or_budget" : kiyasBlock ? "none" : "missing"}`
    );
  }
  console.info(
    `[fund-detail-alternatives] code=${normalizedCode} alternatives_source=${alternativesSource} alternatives_count=${similarFunds.length} ` +
      `alternatives_fallback_used=${alternativesFallbackUsed ? 1 : 0} alternatives_degraded_reason=${alternativesDegradedReason}`
  );
  const phase2CoreMs =
    (steps.latest_snapshot_query ?? 0) +
    (steps.core_fund_query ?? 0) +
    (steps.price_history_query ?? 0) +
    (steps.price_history_postprocess_ms ?? 0) +
    (steps.derived_metrics_query ?? 0) +
    (steps.core_meta_bundle_checkout_wait_ms ?? 0) +
    (steps.fallback_snapshot_series_generation ?? 0) +
    (steps.full_payload_build ?? 0);
  const phase2OptionalMs =
    (steps.optional_related_funds_query ?? 0) +
    (steps.optional_category_averages_query ?? 0) +
    (steps.optional_kiyas_block_query ?? 0) +
    (steps.optional_related_funds_rescue_query ?? 0);
  const prismaStepDurations = [
    ["latest_snapshot_query", steps.latest_snapshot_query ?? 0],
    ["core_meta_bundle_query", steps.core_meta_bundle_query ?? 0],
    ["core_fund_query", steps.core_fund_query ?? 0],
    ["price_history_query", steps.price_history_query ?? 0],
    ["derived_metrics_query", steps.derived_metrics_query ?? 0],
    ["optional_related_funds_query", steps.optional_related_funds_query ?? 0],
    ["optional_category_averages_query", steps.optional_category_averages_query ?? 0],
    ["optional_kiyas_block_query", steps.optional_kiyas_block_query ?? 0],
    ["optional_related_funds_rescue_query", steps.optional_related_funds_rescue_query ?? 0],
  ] as const;
  const longestPrismaStep = prismaStepDurations.reduce<{ name: string; ms: number }>(
    (acc, [name, ms]) => (ms > acc.ms ? { name, ms } : acc),
    { name: "none", ms: 0 }
  );
  const connectionHoldDurations = [
    ["latest_snapshot_query", steps.latest_snapshot_db_exec_ms ?? 0],
    ["price_history_query", steps.price_history_db_exec_ms ?? 0],
    ["core_fund_query", steps.core_fund_query ?? 0],
    ["derived_metrics_query", steps.derived_metrics_query ?? 0],
    ["optional_related_funds_query", steps.optional_related_funds_query ?? 0],
    ["optional_category_averages_query", steps.optional_category_averages_query ?? 0],
    ["optional_kiyas_block_query", steps.optional_kiyas_block_query ?? 0],
    ["optional_related_funds_rescue_query", steps.optional_related_funds_rescue_query ?? 0],
  ] as const;
  const longestConnectionHold = connectionHoldDurations.reduce<{ name: string; ms: number }>(
    (acc, [name, ms]) => (ms > acc.ms ? { name, ms } : acc),
    { name: "none", ms: 0 }
  );
  const snapshotWarm =
    snapshotCacheHit ||
    snapshotDeduped ||
    snapshotSeededFromServing ||
    phase2ServingSeedSource !== "none";
  const historyWarm = priceHistoryCacheHit || priceHistoryDeduped;
  const coldPhase2 = phase === "phase2" && (!snapshotWarm || !historyWarm) ? 1 : 0;
  const phase2TailReason =
    (steps.phase2_queue_wait_ms ?? 0) >= 120
      ? "phase2_queue_wait"
    : priceHistoryCooldownActive
        ? "price_history_cooldown"
      : historyFallbackUsed && DETAIL_HISTORY_SERVING_PRIMARY && (steps.history_live_db_query_ms ?? 0) > 0
        ? "history_serving_fallback_live_db"
      : (steps.latest_snapshot_checkout_wait_ms ?? 0) >= 250
        ? "snapshot_checkout_wait"
      : (steps.price_history_checkout_wait_ms ?? 0) >= 250
          ? "price_history_checkout_wait"
        : longestPrismaStep.name === "price_history_query" && longestPrismaStep.ms > 0
          ? "price_history_query"
          : phase2KiyasTimedOut
            ? "optional_kiyas_timeout"
            : longestPrismaStep.ms > 0
              ? longestPrismaStep.name
              : "none";
  console.info(
    `[fund-detail-phase2-metrics] code=${normalizedCode} phase2_total_ms=${totalMs} ` +
      `phase2_core_ms=${phase2CoreMs} phase2_optional_ms=${phase2OptionalMs} ` +
      `phase2_optional_budget_ms=${Math.round(optionalBudgetMs)} ` +
      `cold_phase2=${coldPhase2} request_reused_context=${requestReusedContext ? 1 : 0} ` +
      `snapshot_seed_source=${phase2ServingSeedSource} ` +
      `first_checkout_target=${firstCheckoutTarget} first_checkout_wait_ms=${firstCheckoutWaitMs} ` +
      `snapshot_query_ms=${steps.latest_snapshot_query ?? 0} ` +
      `snapshot_checkout_wait_ms=${steps.latest_snapshot_checkout_wait_ms ?? 0} ` +
      `snapshot_cache_hit=${snapshotCacheHit ? 1 : 0} snapshot_deduped=${snapshotDeduped ? 1 : 0} ` +
      `price_history_query_ms=${steps.price_history_query ?? 0} price_history_db_ms=${steps.price_history_db_exec_ms ?? 0} ` +
      `price_history_decode_ms=${steps.price_history_decode_ms ?? 0} price_history_rows=${priceHistoryRowsCount} ` +
      `price_history_raw_rows=${priceHistoryRawRowsCount} ` +
      `price_history_source=${priceHistorySource} ` +
      `price_history_query_plan=${priceHistoryQueryPlan} ` +
      `price_history_selected_range=${priceHistorySelectedFromIso}..${priceHistorySelectedToIso} ` +
      `price_history_columns=${priceHistoryColumns} ` +
      `price_history_cache_hit=${priceHistoryCacheHit ? 1 : 0} price_history_deduped=${priceHistoryDeduped ? 1 : 0} ` +
      `price_history_limit_compatible_cache_hit=${priceHistoryLimitCompatibleCacheHit ? 1 : 0} ` +
      `price_history_limit_compatible_inflight_hit=${priceHistoryLimitCompatibleInFlightHit ? 1 : 0} ` +
      `price_history_cooldown_active=${priceHistoryCooldownActive ? 1 : 0} ` +
      `price_history_failure_category=${priceHistoryFailureCategory} ` +
      `price_history_postprocess_ms=${steps.price_history_postprocess_ms ?? 0} ` +
      `history_serving_source=${historyServingSource} history_serving_hit=${historyServingHit ? 1 : 0} ` +
      `history_serving_points=${historyServingPoints} history_serving_range=${historyServingRange} ` +
      `history_serving_staleness=${historyServingStalenessMs} history_serving_snapshot_lag_days=${historyServingSnapshotLagDays ?? -1} ` +
      `history_fallback_used=${historyFallbackUsed ? 1 : 0} ` +
      `history_downsample_mode=${historyDownsampleMode} history_live_db_query_ms=${steps.history_live_db_query_ms ?? 0} ` +
      `kiyas_query_ms=${steps.optional_kiyas_block_query ?? 0} kiyas_timed_out=${phase2KiyasTimedOut ? 1 : 0} ` +
      `longest_connection_hold_step=${longestConnectionHold.name} longest_connection_hold_ms=${longestConnectionHold.ms} ` +
      `longest_prisma_step=${longestPrismaStep.name} longest_prisma_step_ms=${longestPrismaStep.ms} ` +
      `phase2_tail_reason=${phase2TailReason} ` +
      `duplicated_query_prevented=${phase2DuplicatedQueryPrevented} prisma_calls=${phase2PrismaCalls} ` +
      `kiyas_db_calls=${phase2KiyasDbCalls}`
  );

  console.info(
    `[fund-detail] code=${normalizedCode} source=db total_ms=${totalMs} budget_ms=${DETAIL_TOTAL_BUDGET_MS} ` +
      `slowest_step=${slowestStep.name} slowest_ms=${slowestStep.ms} history=${historyRows.length} ` +
      `related=${similarCandidates.length} kiyas=${kiyasBlock ? 1 : 0} kiyas_valid_refs=${comparisonValidRefs} ` +
      `series_source=${performanceSeriesSource} degraded=${partial ? 1 : 0} rescue=${rescueModeActive ? 1 : 0} steps=${JSON.stringify(steps)}`
  );
  emitFundDetailDebugLog(normalizedCode, payload, {
    seriesSource: performanceSeriesSource,
    servingHit: false,
    managerSource: "none",
  });
  if (shouldLogFundDetailDebug(normalizedCode)) {
    const range = coreSeriesDateRange(payload);
    console.info(
      `[fund-detail-phase-series] code=${normalizedCode} phase=phase2 source=${performanceSeriesSource} ` +
        `points=${range.pointCount} min_date=${range.minIso} max_date=${range.maxIso}`
    );
  }
  console.info(
    `[fund-detail-lifecycle] code=${normalizedCode} event=phase2_completed partial=${partial ? 1 : 0} degraded=${payload.degraded?.active ? 1 : 0}`
  );
  return payload;
}

export async function getFundDetailPageData(rawCode: string): Promise<FundDetailPageData | null> {
  const normalizedCode = rawCode.trim().toUpperCase();
  if (!normalizedCode) return null;
  const startedAt = Date.now();
  const state = getDetailRuntimeState();

  const cacheReadStartedAt = Date.now();
  const fresh = pickFreshDetailCache(normalizedCode);
  const stale = pickStaleDetailCache(normalizedCode);
  const cacheReadMs = Date.now() - cacheReadStartedAt;

  const startBackgroundRefresh = (trigger: string, refreshPhase: "phase1" | "phase2"): void => {
    const now = Date.now();
    const blockedUntil = state.failureUntil.get(normalizedCode) ?? 0;
    if (blockedUntil > now) return;
    if (state.phase2InFlight.has(normalizedCode)) return;

    console.info(
      `[fund-detail-lifecycle] code=${normalizedCode} event=phase2_started trigger=${trigger} refresh_phase=${refreshPhase}`
    );
    const refreshPromise = runWithPhase2ConcurrencyLimit(state, async (queueWaitMs): Promise<FundDetailPageData | null> => {
      try {
        if (queueWaitMs > 0) {
          console.info(
            `[fund-detail-phase2-scheduler] code=${normalizedCode} refresh_phase=${refreshPhase} queue_wait_ms=${queueWaitMs} active_limit=${DETAIL_PHASE2_MAX_CONCURRENCY}`
          );
        }
        if (refreshPhase === "phase2") {
          const prime = await primePhase2HistoryRead(state, normalizedCode);
          if (prime.primed || prime.reason !== "no_seed") {
            console.info(
              `[fund-detail-phase2-prime] code=${normalizedCode} primed=${prime.primed ? 1 : 0} ` +
                `reason=${prime.reason} waited_ms=${prime.waitedMs} wait_budget_ms=${DETAIL_PHASE2_HISTORY_PRIME_WAIT_MS}`
            );
          }
        }
        const existing = state.cache.get(normalizedCode);
        const payload = await getFundDetailPageDataUncached(normalizedCode, {
          phase: refreshPhase,
          phase2QueueWaitMs: queueWaitMs,
          alternativesSeed: existing?.payload.similarFunds ?? [],
        });
        if (!payload) return null;
        const incomingKind = inferCacheKind(payload);
        if (!shouldWriteCache(existing, incomingKind, payload)) {
          const existingComparisonRefs = existing?.payload.kiyasBlock?.refs.length ?? 0;
          const incomingComparisonRefs = payload.kiyasBlock?.refs.length ?? 0;
          const existingSnapshotTs = existing?.payload.snapshotDate
            ? new Date(existing.payload.snapshotDate).getTime()
            : Number.NEGATIVE_INFINITY;
          const incomingSnapshotTs = payload.snapshotDate
            ? new Date(payload.snapshotDate).getTime()
            : Number.NEGATIVE_INFINITY;
          if (
            incomingComparisonRefs > 0 &&
            existingComparisonRefs === 0 &&
            incomingSnapshotTs >= existingSnapshotTs &&
            existing
          ) {
            const mergedPayload: FundDetailPageData = {
              ...existing.payload,
              kiyasBlock: payload.kiyasBlock,
            };
            const cacheWriteStartedAt = Date.now();
            const writeMeta = writeDetailCache(state, normalizedCode, mergedPayload);
            emitSectionStateTransitions(state, normalizedCode, mergedPayload, refreshPhase);
            const cacheWriteMs = Date.now() - cacheWriteStartedAt;
            console.info(
              `[fund-detail-cache] code=${normalizedCode} write=${refreshPhase}_compare_merge write_ms=${cacheWriteMs} ` +
                `existing_refs=${existingComparisonRefs} incoming_refs=${incomingComparisonRefs} ` +
                `served_cache_kind=${writeMeta.kind} cache_ttl_used=${writeMeta.freshTtlMs}/${writeMeta.staleTtlMs}`
            );
            return mergedPayload;
          }
          console.info(
            `[fund-detail-cache] code=${normalizedCode} write=${refreshPhase} skipped=1 ` +
              `incoming_kind=${incomingKind} existing_kind=${existing?.kind ?? "none"}`
          );
          return existing?.payload ?? payload;
        }
        const cacheWriteStartedAt = Date.now();
        const writeMeta = writeDetailCache(state, normalizedCode, payload);
        emitSectionStateTransitions(state, normalizedCode, payload, refreshPhase);
        state.failureUntil.delete(normalizedCode);
        const cacheWriteMs = Date.now() - cacheWriteStartedAt;
        if (shouldLogFundDetailDebug(normalizedCode) && refreshPhase === "phase2") {
          const phase2ReplacedPhase1 =
            existing != null &&
            (existing.kind !== writeMeta.kind ||
              existing.payload.priceSeries.length !== payload.priceSeries.length ||
              existing.payload.trendSeries.investorCount.length !== payload.trendSeries.investorCount.length ||
              existing.payload.kiyasBlock == null !== (payload.kiyasBlock == null));
          console.info(
            `[fund-detail-history-upgrade] code=${normalizedCode} phase2_replaced_phase1=${phase2ReplacedPhase1 ? 1 : 0} ` +
              `previous_kind=${existing?.kind ?? "none"} next_kind=${writeMeta.kind} previous_points=${existing?.payload.priceSeries.length ?? 0} ` +
              `next_points=${payload.priceSeries.length} previous_compare=${existing?.payload.kiyasBlock?.refs.length ?? 0} ` +
              `next_compare=${payload.kiyasBlock?.refs.length ?? 0}`
          );
        }
        console.info(
          `[fund-detail-cache] code=${normalizedCode} write=${refreshPhase} write_ms=${cacheWriteMs} ` +
            `served_cache_kind=${writeMeta.kind} cache_ttl_used=${writeMeta.freshTtlMs}/${writeMeta.staleTtlMs} total_ms=${Date.now() - startedAt}`
        );
        if (refreshPhase === "phase1" && (writeMeta.kind === "core_full" || needsPhase2OptionalRefresh(payload))) {
          setTimeout(() => {
            startBackgroundRefresh("core_recovered_enrich", "phase2");
          }, 0);
        }
        return payload;
      } catch (error) {
        state.failureUntil.set(normalizedCode, Date.now() + DETAIL_FAILURE_COOLDOWN_MS);
        console.error(`[fund-detail-cache] ${refreshPhase} refresh failed`, error);
        return null;
      } finally {
        state.phase2InFlight.delete(normalizedCode);
      }
    });
    state.phase2InFlight.set(normalizedCode, refreshPromise);
    void refreshPromise.catch(() => null);
  };

  if (fresh) {
    const servedKind = servedCacheKind(fresh);
    if (fresh.kind !== "full_optional_enriched" || needsPhase2OptionalRefresh(fresh.payload)) {
      startBackgroundRefresh("fresh_non_full", fresh.kind === "emergency" ? "phase1" : "phase2");
    }
    console.info(
      `[fund-detail-cache] code=${normalizedCode} hit=fresh read_ms=${cacheReadMs} ` +
        `served_cache_kind=${servedKind} cache_ttl_used=${fresh.freshTtlMs}/${fresh.staleTtlMs} total_ms=${Date.now() - startedAt}`
    );
    return fresh.payload;
  }

  const now = Date.now();
  const blockedUntil = state.failureUntil.get(normalizedCode) ?? 0;

  const createLoader = (): Promise<FundDetailPageData | null> =>
    (async (): Promise<FundDetailPageData | null> => {
      try {
        const payload = await getFundDetailPageDataUncached(normalizedCode, { phase: "phase1" });
        if (!payload) return null;
        const cacheWriteStartedAt = Date.now();
        const writeMeta = writeDetailCache(state, normalizedCode, payload);
        emitSectionStateTransitions(state, normalizedCode, payload, "phase1");
        state.failureUntil.delete(normalizedCode);
        const cacheWriteMs = Date.now() - cacheWriteStartedAt;
        if (writeMeta.kind === "emergency") {
          startBackgroundRefresh("phase1_emergency_retry_core", "phase1");
        } else if (writeMeta.kind !== "full_optional_enriched" || needsPhase2OptionalRefresh(payload)) {
          startBackgroundRefresh("phase1_non_full_enrich", "phase2");
        }
        console.info(
          `[fund-detail-cache] code=${normalizedCode} write=ok write_ms=${cacheWriteMs} ` +
            `served_cache_kind=${writeMeta.kind} cache_ttl_used=${writeMeta.freshTtlMs}/${writeMeta.staleTtlMs} total_ms=${Date.now() - startedAt}`
        );
        return payload;
      } catch (error) {
        state.failureUntil.set(normalizedCode, Date.now() + DETAIL_FAILURE_COOLDOWN_MS);
        if (stale) {
          console.error("[fund-detail-cache] live load failed; stale returned", error);
          return withDegradedPayload(stale.payload, {
            stale: true,
            partial: true,
            reasons: ["live_load_failed"],
            failedSteps: [],
          });
        }
        console.error("[fund-detail-cache] live load failed; emergency returned", error);
        return withDegradedPayload(buildEmergencyDetailFallbackPayload(normalizedCode), {
          stale: false,
          partial: true,
          reasons: ["live_load_failed_no_stale"],
          failedSteps: [],
        });
      } finally {
        state.inFlight.delete(normalizedCode);
      }
    })();

  const existingInFlight = state.inFlight.get(normalizedCode);
  if (stale) {
    if (!existingInFlight) {
      startBackgroundRefresh("stale_immediate", stale.kind === "emergency" ? "phase1" : "phase2");
    }
    const staleReason = blockedUntil > now ? "recent_failure_cooldown" : "stale_immediate";
    const payload = withDegradedPayload(stale.payload, {
      stale: true,
      partial: true,
      reasons: [staleReason],
      failedSteps: [],
    });
    const servedKind = servedCacheKind(stale);
    console.info(
      `[fund-detail-cache] code=${normalizedCode} hit=stale-immediate read_ms=${cacheReadMs} ` +
        `cooldown_ms=${Math.max(0, blockedUntil - now)} served_cache_kind=${servedKind} ` +
        `cache_ttl_used=${stale.freshTtlMs}/${stale.staleTtlMs} total_ms=${Date.now() - startedAt}`
    );
    return payload;
  }

  if (existingInFlight) {
    let budgetFallbackTriggered = false;
    const budgetFallback = new Promise<FundDetailPageData>((resolve) => {
      setTimeout(() => {
        budgetFallbackTriggered = true;
        resolve(
          withDegradedPayload(buildEmergencyDetailFallbackPayload(normalizedCode), {
            stale: false,
            partial: true,
            reasons: ["inflight_budget_timeout_emergency_fallback"],
            failedSteps: [],
          })
        );
      }, DETAIL_TOTAL_BUDGET_MS);
    });
    const result = await Promise.race([existingInFlight, budgetFallback]);
    if (budgetFallbackTriggered) {
      console.info(
        `[fund-detail-cache] code=${normalizedCode} hit=inflight-budget-emergency timeout_ms=${DETAIL_TOTAL_BUDGET_MS} total_ms=${Date.now() - startedAt}`
      );
    }
    return result;
  }

  const loader = createLoader();
  state.inFlight.set(normalizedCode, loader);
  let budgetFallbackTriggered = false;
  const budgetFallback = new Promise<FundDetailPageData>((resolve) => {
    setTimeout(() => {
      budgetFallbackTriggered = true;
      resolve(
        withDegradedPayload(buildEmergencyDetailFallbackPayload(normalizedCode), {
          stale: false,
          partial: true,
          reasons: ["budget_timeout_emergency_fallback"],
          failedSteps: [],
        })
      );
    }, DETAIL_TOTAL_BUDGET_MS);
  });
  const result = await Promise.race([loader, budgetFallback]);
  if (budgetFallbackTriggered) {
    console.info(
      `[fund-detail-cache] code=${normalizedCode} hit=budget-emergency timeout_ms=${DETAIL_TOTAL_BUDGET_MS} total_ms=${Date.now() - startedAt}`
    );
  }
  return result;
}

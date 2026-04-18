import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import type { RankingMode } from "@/lib/scoring";
import type { ScoresApiPayload } from "@/lib/services/fund-scores-types";
import { getScoresPayloadFromDailySnapshot } from "@/lib/services/fund-daily-snapshot.service";
import {
  filterScoresPayloadByQuery,
  filterScoresPayloadByTheme,
} from "@/lib/services/fund-scores-compute.service";
import {
  applyScoresPayloadRowLimit,
  coerceScoresPayloadFromLegacy,
  createScoresPayload,
} from "@/lib/services/fund-scores-semantics";
import { scoresApiCacheKey } from "@/lib/services/fund-scores-cache.service";
import { prisma } from "@/lib/prisma";
import { getAllFundsCached, getFundsPage } from "@/lib/services/fund-list.service";
import { classifyDatabaseError } from "@/lib/database-error-classifier";
import { buildDbAccessResolutionLog, logDbAccessResolution } from "@/lib/db/db-access-resolution-log";
import { resolveDbConnectionProfile } from "@/lib/db/db-connection-profile";
import { getDbEnvStatus, sanitizeFailureDetail } from "@/lib/db-env-validation";
import { parseFundThemeParam, type FundThemeId } from "@/lib/fund-themes";
import { getFundDetailCoreServingUniversePayloads } from "@/lib/services/fund-detail-core-serving.service";
import { fetchSupabaseRestJson, hasSupabaseRestConfig } from "@/lib/supabase-rest";
import {
  evaluateDiscoveryReliability,
  reliabilitySourceFromDiscoverySource,
} from "@/lib/fund-data-reliability";
import { deriveDiscoveryHealth } from "@/lib/discovery-orchestrator";
import {
  enforceServingRouteTrust,
  readServingDiscoveryPrimary,
  readServingFundListPrimary,
  servingHeaders,
} from "@/lib/data-platform/read-side-serving";
import {
  isServingStrictModeEnabled,
  servingStrictHeaders,
} from "@/lib/data-platform/serving-strict-mode";
import {
  resolveScoresApiSurfaceState,
  validateScoresApiPayloadContract,
} from "@/app/api/funds/scores/contract";
import { guardSemanticInvariant } from "@/lib/data-flow/invariant-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_CATEGORY_LENGTH = 32;
const MAX_QUERY_LENGTH = 64;
const MAX_LIMIT = 2500;

const SCORES_SERVER_TIMEOUT_MS = parseEnvMs("SCORES_SERVER_TIMEOUT_MS", 4_500, 2_500, 20_000);
const SCORES_FRESH_TTL_MS = parseEnvMs("SCORES_ROUTE_CACHE_TTL_MS", 90_000, 10_000, 10 * 60_000);
const SCORES_STALE_TTL_MS = parseEnvMs("SCORES_ROUTE_STALE_TTL_MS", 10 * 60_000, 30_000, 60 * 60_000);
const SCORES_PERSISTED_CACHE_TIMEOUT_MS = parseEnvMs("SCORES_PERSISTED_CACHE_TIMEOUT_MS", 1_000, 400, 5_000);
const SCORES_PERSISTED_CACHE_TIMEOUT_BEST_ALL_MS = parseEnvMs(
  "SCORES_PERSISTED_CACHE_TIMEOUT_BEST_ALL_MS",
  900,
  600,
  8_000
);
const SCORES_PERSISTED_REST_CACHE_TIMEOUT_MS = parseEnvMs("SCORES_PERSISTED_REST_CACHE_TIMEOUT_MS", 1_000, 1_000, 5_000);
const SCORES_LIGHT_FALLBACK_TIMEOUT_MS = parseEnvMs("SCORES_LIGHT_FALLBACK_TIMEOUT_MS", 1_500, 600, 6_000);
const SCORES_FUNDS_LIST_FALLBACK_TIMEOUT_MS = parseEnvMs("SCORES_FUNDS_LIST_FALLBACK_TIMEOUT_MS", 2_000, 500, 6_000);
const SCORES_CORE_SERVING_FALLBACK_TIMEOUT_MS = parseEnvMs(
  "SCORES_CORE_SERVING_FALLBACK_TIMEOUT_MS",
  1_600,
  500,
  6_000
);
const SCORES_LIGHT_FALLBACK_LIMIT = 300;

type ScoresCacheEntry = {
  payload: ScoresApiPayload;
  updatedAt: number;
};

type ScoresRuntimeState = {
  cache: Map<string, ScoresCacheEntry>;
  inflight: Map<string, Promise<ScoresApiPayload>>;
};

type ScoresApiCacheRestRow = {
  payload: unknown;
};

type GlobalWithScoresRouteState = typeof globalThis & {
  __scoresRouteState?: ScoresRuntimeState;
};

function parseEnvMs(name: string, fallback: number, min: number, max: number): number {
  const rawValue = process.env[name];
  if (typeof rawValue !== "string" || rawValue.trim() === "") return fallback;
  const raw = Number(rawValue);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(raw)));
}

function getScoresRouteState(): ScoresRuntimeState {
  const g = globalThis as GlobalWithScoresRouteState;
  if (!g.__scoresRouteState) {
    g.__scoresRouteState = { cache: new Map<string, ScoresCacheEntry>(), inflight: new Map<string, Promise<ScoresApiPayload>>() };
  }
  return g.__scoresRouteState;
}

function baseScoresKey(mode: RankingMode, categoryCode: string, limit: number | null): string {
  return `${mode}|${categoryCode || "all"}|${limit ?? "all"}`;
}

function normalizeScoresScopePart(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function responseScoresKey(
  mode: RankingMode,
  categoryCode: string,
  limit: number | null,
  queryTrim: string,
  theme: FundThemeId | null
): string {
  const base = baseScoresKey(mode, categoryCode, limit);
  const normalizedQuery = normalizeScoresScopePart(queryTrim);
  if (!normalizedQuery && !theme) return base;
  return `${base}|theme:${theme ?? "none"}|q:${normalizedQuery || "none"}`;
}

function requestScopeKey(
  mode: RankingMode,
  categoryCode: string,
  queryTrim: string,
  theme: FundThemeId | null
): string {
  return `${mode}|${categoryCode.trim().toUpperCase() || "all"}|${theme ?? "none"}|q:${
    normalizeScoresScopePart(queryTrim) || "none"
  }`;
}

function parseLimit(searchParams: URLSearchParams): number | null {
  const raw = searchParams.get("limit");
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(Math.trunc(parsed), MAX_LIMIT);
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("scores_timeout_");
}

function shouldShortCircuitDbFallback(category: string): boolean {
  return (
    category === "pool_checkout_timeout" ||
    category === "query_execution_timeout" ||
    category === "transaction_timeout" ||
    category === "connection_closed" ||
    category === "connect_timeout" ||
    category === "network_unreachable" ||
    category === "auth_failed" ||
    category === "invalid_datasource"
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`scores_timeout_${timeoutMs}ms`));
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

function buildEmptyPayload(mode: RankingMode): ScoresApiPayload {
  return createScoresPayload({ mode, funds: [], universeTotal: 0, matchedTotal: 0 });
}

function hasUsableScoresPayload(payload: ScoresApiPayload | null | undefined): payload is ScoresApiPayload {
  return Boolean(payload && Array.isArray(payload.funds) && payload.funds.length > 0);
}

function sanitizePersistedPayload(mode: RankingMode, payload: unknown): ScoresApiPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const candidate = payload as ScoresApiPayload;
  if (!Array.isArray(candidate.funds)) return null;
  const legacyTotal = typeof candidate.total === "number" ? candidate.total : candidate.funds.length;
  const universeTotal =
    typeof candidate.universeTotal === "number" && Number.isFinite(candidate.universeTotal)
      ? candidate.universeTotal
      : legacyTotal;
  const matchedTotal =
    typeof candidate.matchedTotal === "number" && Number.isFinite(candidate.matchedTotal)
      ? candidate.matchedTotal
      : legacyTotal;
  const returned = candidate.funds.length;
  return createScoresPayload({
    mode,
    funds: candidate.funds,
    universeTotal,
    matchedTotal: Math.max(matchedTotal, returned),
    ...(typeof candidate.appliedQuery === "string" && candidate.appliedQuery.trim()
      ? { appliedQuery: candidate.appliedQuery }
      : {}),
  });
}

function pickFreshCache(state: ScoresRuntimeState, key: string): ScoresApiPayload | null {
  const hit = state.cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.updatedAt > SCORES_FRESH_TTL_MS) return null;
  if (!hasUsableScoresPayload(hit.payload)) return null;
  return coerceScoresPayloadFromLegacy(hit.payload);
}

function pickStaleCache(state: ScoresRuntimeState, key: string): ScoresApiPayload | null {
  const hit = state.cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.updatedAt > SCORES_STALE_TTL_MS) return null;
  if (!hasUsableScoresPayload(hit.payload)) return null;
  return coerceScoresPayloadFromLegacy(hit.payload);
}

async function readPersistedScoresPayload(mode: RankingMode, categoryCode: string): Promise<ScoresApiPayload | null> {
  const cacheKey = scoresApiCacheKey(mode, categoryCode, "");
  const restPayload = await readPersistedScoresPayloadFromRest(mode, cacheKey);
  if (restPayload) return restPayload;
  const row = await withTimeout(
    prisma.scoresApiCache.findUnique({
      where: { cacheKey },
      select: { payload: true },
    }),
    SCORES_PERSISTED_CACHE_TIMEOUT_MS
  ).catch(() => null);
  if (!row?.payload) return null;
  return sanitizePersistedPayload(mode, row.payload);
}

async function readPersistedScoresPayloadBestAll(mode: RankingMode): Promise<ScoresApiPayload | null> {
  const cacheKey = scoresApiCacheKey(mode, "", "");
  const restPayload = await readPersistedScoresPayloadFromRest(mode, cacheKey);
  if (restPayload) return restPayload;
  const row = await withTimeout(
    prisma.scoresApiCache.findUnique({
      where: { cacheKey },
      select: { payload: true },
    }),
    SCORES_PERSISTED_CACHE_TIMEOUT_BEST_ALL_MS
  ).catch(() => null);
  if (!row?.payload) return null;
  return sanitizePersistedPayload(mode, row.payload);
}

async function readPersistedScoresPayloadFromRest(
  mode: RankingMode,
  cacheKey: string
): Promise<ScoresApiPayload | null> {
  if (!hasSupabaseRestConfig()) return null;
  const encodedKey = encodeURIComponent(cacheKey);
  const rows = await fetchSupabaseRestJson<ScoresApiCacheRestRow[]>(
    `ScoresApiCache?select=payload&cacheKey=eq.${encodedKey}&limit=1`,
    {
      revalidate: 60,
      timeoutMs: SCORES_PERSISTED_REST_CACHE_TIMEOUT_MS,
      retries: 0,
      countFailureForCircuit: false,
    }
  ).catch(() => null);
  const payload = rows?.[0]?.payload;
  return sanitizePersistedPayload(mode, payload);
}

async function readLightSnapshotFallback(mode: RankingMode, categoryCode: string): Promise<ScoresApiPayload | null> {
  const payload = await withTimeout(
    getScoresPayloadFromDailySnapshot(mode, categoryCode, {
      limit: SCORES_LIGHT_FALLBACK_LIMIT,
      includeTotal: false,
    }),
    SCORES_LIGHT_FALLBACK_TIMEOUT_MS
  ).catch(() => null);
  return payload ?? null;
}

async function readFundsListFallback(
  mode: RankingMode,
  categoryCode: string,
  queryTrim = "",
  limit = SCORES_LIGHT_FALLBACK_LIMIT
): Promise<ScoresApiPayload | null> {
  const page = await withTimeout(
    getFundsPage({
      page: 1,
      pageSize: Math.min(MAX_LIMIT, Math.max(1, limit)),
      q: queryTrim,
      category: categoryCode || undefined,
      fundType: undefined,
      sortField: "portfolioSize",
      sortDir: "desc",
    }),
    SCORES_FUNDS_LIST_FALLBACK_TIMEOUT_MS
  ).catch(() => null);
  if (!page) return null;
  return createScoresPayload({
    mode,
    universeTotal: page.total,
    matchedTotal: page.total,
    funds: page.items.map((item) => ({
      fundId: item.id,
      code: item.code,
      name: item.name,
      shortName: item.shortName,
      logoUrl: item.logoUrl,
      lastPrice: item.lastPrice,
      dailyReturn: item.dailyReturn,
      portfolioSize: item.portfolioSize,
      investorCount: item.investorCount,
      category: item.category ? { code: item.category.code, name: item.category.name } : null,
      fundType: item.fundType ? { code: item.fundType.code, name: item.fundType.name } : null,
      finalScore: null,
    })),
  });
}

async function readThemeFundsListFallback(
  mode: RankingMode,
  categoryCode: string,
  theme: FundThemeId,
  queryTrim = ""
): Promise<ScoresApiPayload | null> {
  const rows = await withTimeout(
    getAllFundsCached(),
    SCORES_FUNDS_LIST_FALLBACK_TIMEOUT_MS
  ).catch(() => []);
  if (rows.length === 0) return null;
  const categoryFunds = rows
    .filter((item) => (categoryCode ? item.category?.code === categoryCode : true))
    .map((item) => ({
      fundId: item.id,
      code: item.code,
      name: item.name,
      shortName: item.shortName,
      logoUrl: item.logoUrl,
      lastPrice: item.lastPrice,
      dailyReturn: item.dailyReturn,
      portfolioSize: item.portfolioSize,
      investorCount: item.investorCount,
      category: item.category ? { code: item.category.code, name: item.category.name } : null,
      fundType: item.fundType ? { code: item.fundType.code, name: item.fundType.name } : null,
      finalScore: null,
    }));
  const basePayload = createScoresPayload({
    mode,
    funds: categoryFunds,
    universeTotal: categoryFunds.length,
    matchedTotal: categoryFunds.length,
  });
  const queryPayload = queryTrim ? filterScoresPayloadByQuery(basePayload, queryTrim) : basePayload;
  const themed = filterScoresPayloadByTheme(queryPayload, theme);
  if (!hasUsableScoresPayload(themed)) return null;
  const funds = [...themed.funds].sort((a, b) => {
    if (mode === "HIGH_RETURN") {
      const daily = b.dailyReturn - a.dailyReturn;
      if (daily !== 0) return daily;
    }
    if (mode === "LOW_RISK") {
      const risk = Math.abs(a.dailyReturn) - Math.abs(b.dailyReturn);
      if (risk !== 0) return risk;
    }
    const portfolio = b.portfolioSize - a.portfolioSize;
    if (portfolio !== 0) return portfolio;
    return a.code.localeCompare(b.code, "tr");
  });
  return createScoresPayload({
    mode,
    funds,
    universeTotal: themed.universeTotal,
    matchedTotal: funds.length,
    appliedQuery: themed.appliedQuery,
  });
}

async function readPersistedAllScoresFilteredFallback(
  mode: RankingMode,
  categoryCode: string,
  queryTrim = ""
): Promise<ScoresApiPayload | null> {
  const modePayload = await readPersistedScoresPayloadBestAll(mode);
  const allPayload = hasUsableScoresPayload(modePayload)
    ? modePayload
    : mode === "BEST"
      ? null
      : await readPersistedScoresPayloadBestAll("BEST");
  if (!hasUsableScoresPayload(allPayload)) return null;
  const categoryFiltered = categoryCode
    ? allPayload.funds.filter((fund) => fund.category?.code === categoryCode)
    : allPayload.funds;
  const sorted = [...categoryFiltered].sort((a, b) => {
    if (mode === "HIGH_RETURN") {
      const daily = b.dailyReturn - a.dailyReturn;
      if (daily !== 0) return daily;
    }
    const portfolio = b.portfolioSize - a.portfolioSize;
    if (portfolio !== 0) return portfolio;
    return a.code.localeCompare(b.code, "tr");
  });
  const payload = createScoresPayload({
    mode,
    funds: sorted,
    universeTotal: sorted.length,
    matchedTotal: sorted.length,
  });
  return queryTrim ? filterScoresPayloadByQuery(payload, queryTrim) : payload;
}

async function readCoreServingScoresFallback(
  mode: RankingMode,
  categoryCode: string,
  limit: number | null
): Promise<ScoresApiPayload | null> {
  const requestedLimit = Math.max(limit ?? SCORES_LIGHT_FALLBACK_LIMIT, SCORES_LIGHT_FALLBACK_LIMIT);
  const serving = await withTimeout(
    getFundDetailCoreServingUniversePayloads(),
    SCORES_CORE_SERVING_FALLBACK_TIMEOUT_MS
  ).catch(() => null);
  if (!serving) return null;
  if (serving.records.length === 0) return null;
  const rows = serving.records
    .map((payload) => ({
      fundId: payload.fund.fundId,
      code: payload.fund.code,
      name: payload.fund.name,
      shortName: payload.fund.shortName,
      logoUrl: payload.fund.logoUrl,
      categoryCode: payload.fund.categoryCode,
      categoryName: payload.fund.categoryName,
      fundTypeCode: payload.fund.fundTypeCode,
      fundTypeName: payload.fund.fundTypeName,
      lastPrice: payload.latestPrice,
      dailyReturn: payload.dailyChangePct,
      portfolioSize: payload.portfolioSummary?.current ?? 0,
      investorCount: payload.investorSummary?.current ?? 0,
    }))
    .filter((row) => (categoryCode ? row.categoryCode === categoryCode : true));
  if (rows.length === 0) return null;
  rows.sort((a, b) => {
    if (mode === "HIGH_RETURN") {
      const dailyDiff = b.dailyReturn - a.dailyReturn;
      if (dailyDiff !== 0) return dailyDiff;
    }
    if (mode === "LOW_RISK") {
      const riskA = Math.abs(a.dailyReturn);
      const riskB = Math.abs(b.dailyReturn);
      if (riskA !== riskB) return riskA - riskB;
    }
    const portfolioDiff = b.portfolioSize - a.portfolioSize;
    if (portfolioDiff !== 0) return portfolioDiff;
    return a.code.localeCompare(b.code, "tr");
  });
  const sliced = rows.slice(0, Math.min(requestedLimit, MAX_LIMIT));
  return createScoresPayload({
    mode,
    universeTotal: rows.length,
    matchedTotal: rows.length,
    funds: sliced.map((row) => ({
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

function normalizeRankingMode(searchParams: URLSearchParams): RankingMode {
  const sortRaw = (searchParams.get("sortMode") ?? "").toLowerCase().replace(/-/g, "");
  if (sortRaw === "lowrisk") return "LOW_RISK";
  if (sortRaw === "highreturn") return "HIGH_RETURN";
  if (sortRaw === "stable") return "STABLE";
  if (sortRaw === "best") return "BEST";

  const mode = searchParams.get("mode") || "BEST";
  if (mode === "LOW_RISK" || mode === "HIGH_RETURN" || mode === "STABLE") return mode;
  return "BEST";
}

async function resolveBasePayload(
  mode: RankingMode,
  categoryCode: string,
  limit: number | null
): Promise<{ payload: ScoresApiPayload; cacheState: "hit" | "miss" | "dedupe" }> {
  const key = baseScoresKey(mode, categoryCode, limit);
  const state = getScoresRouteState();

  const fresh = pickFreshCache(state, key);
  if (fresh) {
    return { payload: fresh, cacheState: "hit" };
  }

  const inflight = state.inflight.get(key);
  if (inflight) {
    const payload = await inflight;
    return { payload, cacheState: "dedupe" };
  }

  const buildPromise = withTimeout(
    getScoresPayloadFromDailySnapshot(mode, categoryCode, {
      ...(limit ? { limit } : {}),
      includeTotal: true,
    }),
    SCORES_SERVER_TIMEOUT_MS
  ).then((payload) => {
    if (!payload) {
      throw new Error("scores_snapshot_unavailable");
    }
    if (hasUsableScoresPayload(payload)) {
      state.cache.set(key, { payload, updatedAt: Date.now() });
    }
    return payload;
  });

  state.inflight.set(key, buildPromise);
  try {
    const payload = await buildPromise;
    return { payload, cacheState: "miss" };
  } finally {
    state.inflight.delete(key);
  }
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const strictMode = isServingStrictModeEnabled(request);
  const dbEnvStatus = getDbEnvStatus();
  const dbConnProfile = resolveDbConnectionProfile();
  const dbHeaders = {
    "X-Db-Env-Status": dbEnvStatus.failureCategory ?? "ok",
    "X-Db-Connection-Mode": dbEnvStatus.connectionMode,
    "X-Db-Env-Path": dbConnProfile.envPath,
    "X-Db-Prisma-Datasource": "POSTGRES_PRISMA_URL|DATABASE_URL",
    "X-Prisma-Runtime-Env-Key": dbConnProfile.prismaRuntimeEnvKey,
  };
  const { searchParams } = new URL(request.url);
  const mode = normalizeRankingMode(searchParams);
  const categoryCode = (searchParams.get("category") ?? "").trim().slice(0, MAX_CATEGORY_LENGTH);
  const theme = parseFundThemeParam(searchParams.get("theme") ?? "");
  const queryTrim = (searchParams.get("q") ?? searchParams.get("query") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const limit = parseLimit(searchParams);
  const isCriticalBestAllPath = mode === "BEST" && !categoryCode && !queryTrim && !theme;
  const key = responseScoresKey(mode, categoryCode, limit, queryTrim, theme);
  const scopeRequestKey = requestScopeKey(mode, categoryCode, queryTrim, theme);
  const state = getScoresRouteState();
  const [servingDiscovery, servingFundList] = await Promise.all([
    readServingDiscoveryPrimary(),
    readServingFundListPrimary(),
  ]);
  const servingWorld = servingDiscovery.world ?? servingFundList.world ?? null;
  const servingPrimaryTrust = enforceServingRouteTrust({
    world: servingWorld,
    source: "serving_discovery_index",
    requiredBuilds: ["fundList", "discovery", "system"],
    payloadAvailable: Boolean(servingDiscovery.payload && servingFundList.payload),
    fallbackUsed: false,
  });

  if (servingDiscovery.payload && servingFundList.payload) {
    const strictServingTrust =
      servingPrimaryTrust.trustAsFinal &&
      servingDiscovery.trust.trustAsFinal &&
      servingFundList.trust.trustAsFinal;
    if (strictMode && !strictServingTrust) {
      return NextResponse.json(
        {
          error: "serving_strict_violation",
          route: "/api/funds/scores",
          reason:
            servingPrimaryTrust.degradedReason ??
            servingDiscovery.trust.degradedReason ??
            servingFundList.trust.degradedReason ??
            "serving_primary_not_final",
        },
        {
          status: 503,
          headers: {
            ...servingHeaders({
              world: servingWorld,
              trust: {
                trustAsFinal: strictServingTrust,
                degradedKind:
                  servingPrimaryTrust.degradedKind !== "none"
                    ? servingPrimaryTrust.degradedKind
                    : servingDiscovery.trust.degradedKind !== "none"
                      ? servingDiscovery.trust.degradedKind
                      : servingFundList.trust.degradedKind,
                degradedReason:
                  servingPrimaryTrust.degradedReason ??
                  servingDiscovery.trust.degradedReason ??
                  servingFundList.trust.degradedReason,
              },
              routeSource: "serving_discovery_index",
              fallbackUsed: false,
            }),
            ...servingStrictHeaders({
              enabled: strictMode,
              violated: true,
              reason:
                servingPrimaryTrust.degradedReason ??
                servingDiscovery.trust.degradedReason ??
                servingFundList.trust.degradedReason ??
                "serving_primary_not_final",
            }),
          },
        }
      );
    }
    const fundsByCode = new Map(
      servingFundList.payload.funds.map((fund) => [fund.code.trim().toUpperCase(), fund])
    );
    const rankedRows = [...servingDiscovery.payload.funds]
      .filter((row) => (categoryCode ? row.categoryCode === categoryCode : true))
      .sort((left, right) => left.rank - right.rank);
    const servingFunds: ScoresApiPayload["funds"] = [];
    for (const row of rankedRows) {
      const fund = fundsByCode.get(row.code.trim().toUpperCase());
      if (!fund) continue;
      servingFunds.push({
        fundId: fund.code,
        code: fund.code,
        name: fund.name,
        shortName: fund.shortName,
        logoUrl: null,
        lastPrice: fund.lastPrice,
        dailyReturn: fund.dailyReturn,
        portfolioSize: fund.portfolioSize,
        investorCount: fund.investorCount,
        category: fund.categoryCode ? { code: fund.categoryCode, name: fund.categoryCode } : null,
        fundType: fund.fundTypeCode != null ? { code: fund.fundTypeCode, name: String(fund.fundTypeCode) } : null,
        finalScore: row.score,
      });
    }
    const materialized = createScoresPayload({
      mode,
      funds: servingFunds,
      universeTotal: rankedRows.length,
      matchedTotal: servingFunds.length,
    });
    const queryPayload = queryTrim ? filterScoresPayloadByQuery(materialized, queryTrim) : materialized;
    const themedPayload = filterScoresPayloadByTheme(queryPayload, theme);
    const limitedPayload = applyScoresPayloadRowLimit(themedPayload, limit && limit > 0 ? limit : null);
    const discoveryHealth = deriveDiscoveryHealth({
      payload: limitedPayload,
      scope: {
        mode,
        categoryCode,
        theme,
        queryTrim,
      },
      source: "serving_discovery",
      degradedReason: null,
      failureClass: null,
      stale: false,
      requestConsistent: true,
    });
    const contractCheck = validateScoresApiPayloadContract(limitedPayload);
    if (!contractCheck.valid) {
      guardSemanticInvariant({
        scope: "scores_api_contract_serving_primary",
        reason: contractCheck.reason ?? "unknown",
        payload: {
          mode,
          categoryCode,
          theme,
          queryTrim,
          returnedCount: limitedPayload.funds.length,
          matchedTotal: limitedPayload.matchedTotal,
          universeTotal: limitedPayload.universeTotal,
        },
      });
    }
    const surfaceState = resolveScoresApiSurfaceState({ payload: limitedPayload, degradedReason: null });
    return NextResponse.json(
      {
        ...limitedPayload,
        meta: {
          servingWorld,
          surfaceState,
          reliability: {
            overall: discoveryHealth.overallDiscoveryHealth,
            scope: discoveryHealth.scopeHealth,
              trustAsFinal: strictServingTrust,
          },
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
          "X-Scores-Source": "serving_discovery_index",
          "X-Scores-Cache": "serving-primary",
          "X-Scores-Surface-State": surfaceState,
          "X-Discover-Theme": theme ?? "none",
          "X-Discover-Server-Result-Count": String(limitedPayload.funds.length),
          "X-Discover-Universe-Total": String(limitedPayload.universeTotal),
          ...servingHeaders({
            world: servingWorld,
            trust: {
              trustAsFinal: strictServingTrust,
              degradedKind:
                servingPrimaryTrust.degradedKind !== "none"
                  ? servingPrimaryTrust.degradedKind
                  : servingDiscovery.trust.degradedKind !== "none"
                    ? servingDiscovery.trust.degradedKind
                    : servingFundList.trust.degradedKind,
              degradedReason:
                servingPrimaryTrust.degradedReason ??
                servingDiscovery.trust.degradedReason ??
                servingFundList.trust.degradedReason,
            },
            routeSource: "serving_discovery_index",
            fallbackUsed: false,
          }),
          "X-Discovery-Reliability-Class": discoveryHealth.reliabilityClass,
          "X-Discovery-Trust-Final": discoveryHealth.trustAsFinal ? "1" : "0",
          "X-Discovery-Scope-Aligned": discoveryHealth.scopeHealth === "healthy" ? "1" : "0",
          "X-Discovery-Overall-Health": discoveryHealth.overallDiscoveryHealth,
          "X-Discovery-Request-Key": scopeRequestKey,
          ...servingStrictHeaders({ enabled: strictMode, violated: false }),
        },
      }
    );
  }
  if (strictMode) {
    return NextResponse.json(
      {
        error: "serving_strict_violation",
        route: "/api/funds/scores",
        reason: "serving_discovery_or_fund_list_unavailable",
      },
      {
        status: 503,
        headers: {
          ...servingHeaders({
            world: servingWorld,
            trust: servingPrimaryTrust,
            routeSource: "legacy_fallback",
            fallbackUsed: true,
          }),
          ...servingStrictHeaders({
            enabled: strictMode,
            violated: true,
            reason: "serving_discovery_or_fund_list_unavailable",
          }),
          ...dbHeaders,
        },
      }
    );
  }

  let cacheState: "hit" | "miss" | "dedupe" | "stale" | "db-cache" | "light" | "funds-list" | "empty" = "miss";
  let source: "snapshot" | "memory" | "stale" | "db-cache" | "light" | "funds-list" | "empty" = "snapshot";
  let degradedReason: string | null = null;
  let failureClass: string | null = null;
  let basePayload: ScoresApiPayload = buildEmptyPayload(mode);
  const applyResolvedPayload = (
    payload: ScoresApiPayload,
    nextSource: typeof source,
    nextCacheState: typeof cacheState
  ): void => {
    basePayload = coerceScoresPayloadFromLegacy(payload);
    source = nextSource;
    cacheState = nextCacheState;
  };
  const logDbRouteFailure = (classified: ReturnType<typeof classifyDatabaseError>): void => {
    console.error("[db-route-failure]", {
      route: "/api/funds/scores",
      failureClass: classified.category,
      envConfigured: dbEnvStatus.configured,
      dbEnvStatus: dbEnvStatus.failureCategory ?? "ok",
      connectionMode: dbEnvStatus.connectionMode,
      prismaCode: classified.prismaCode,
      retryable: classified.retryable,
      message: sanitizeFailureDetail(classified.message),
      timestamp: new Date().toISOString(),
    });
  };

  console.info(
    `[discover-server-query] mode=${mode} category=${categoryCode || "all"} theme=${theme ?? "none"} ` +
      `limit=${limit ?? "none"} q=${queryTrim ? "1" : "0"}`
  );

  let handledByCriticalPath = false;
  if (isCriticalBestAllPath) {
    const fresh = pickFreshCache(state, key);
    if (fresh && fresh.funds.length > 0) {
      applyResolvedPayload(fresh, "memory", "hit");
      handledByCriticalPath = true;
    }
    const stale = handledByCriticalPath ? null : pickStaleCache(state, key);
    if (stale && stale.funds.length > 0) {
      applyResolvedPayload(stale, "stale", "stale");
      handledByCriticalPath = true;
    } else {
      const persisted = await readPersistedScoresPayloadBestAll(mode);
      if (persisted && persisted.funds.length > 0) {
        applyResolvedPayload(persisted, "db-cache", "db-cache");
        handledByCriticalPath = true;
      } else {
        const servingFallback = await readCoreServingScoresFallback(mode, categoryCode, limit).catch(() => null);
        if (servingFallback && servingFallback.funds.length > 0) {
          applyResolvedPayload(servingFallback, "light", "light");
          handledByCriticalPath = true;
        } else {
          const fundsListFallback = await readFundsListFallback(mode, categoryCode);
          if (fundsListFallback && fundsListFallback.funds.length > 0) {
            applyResolvedPayload(fundsListFallback, "funds-list", "funds-list");
            handledByCriticalPath = true;
          } else {
            try {
              const resolved = await resolveBasePayload(mode, categoryCode, limit);
              applyResolvedPayload(resolved.payload, "snapshot", resolved.cacheState);
            } catch (error) {
              const classified = classifyDatabaseError(error);
              failureClass = classified.category;
              degradedReason = isTimeoutError(error)
                ? `timeout_empty_fast_${classified.category}`
                : `error_empty_fast_${classified.category}`;
              applyResolvedPayload(buildEmptyPayload(mode), "empty", "empty");
              logDbRouteFailure(classified);
            }
            handledByCriticalPath = true;
          }
        }
      }
    }
  }

  if (!handledByCriticalPath) {
    const fresh = pickFreshCache(state, key);
    if (fresh) {
      applyResolvedPayload(fresh, "memory", "hit");
      handledByCriticalPath = true;
    }
  }
  if (!handledByCriticalPath) {
    const stale = pickStaleCache(state, key);
    if (stale) {
      applyResolvedPayload(stale, "stale", "stale");
      handledByCriticalPath = true;
    }
  }

  if (!handledByCriticalPath) {
    try {
      const resolved = await resolveBasePayload(mode, categoryCode, limit);
      applyResolvedPayload(resolved.payload, "snapshot", resolved.cacheState);
      if (categoryCode && basePayload.funds.length === 0) {
        const scoresCacheFallback = await readPersistedAllScoresFilteredFallback(mode, categoryCode, queryTrim);
        const fundsListFallback = hasUsableScoresPayload(scoresCacheFallback)
          ? null
          : await readFundsListFallback(mode, categoryCode, queryTrim);
        const servingFallback = hasUsableScoresPayload(scoresCacheFallback) || hasUsableScoresPayload(fundsListFallback)
          ? null
          : await readCoreServingScoresFallback(mode, categoryCode, limit).catch(() => null);
        const repaired = hasUsableScoresPayload(scoresCacheFallback)
          ? scoresCacheFallback
          : hasUsableScoresPayload(fundsListFallback)
            ? fundsListFallback
            : servingFallback;
        if (hasUsableScoresPayload(repaired)) {
          const repairedSource = hasUsableScoresPayload(scoresCacheFallback)
            ? "db-cache"
            : hasUsableScoresPayload(fundsListFallback)
              ? "funds-list"
              : "light";
          applyResolvedPayload(
            repaired,
            repairedSource,
            repairedSource
          );
          degradedReason = "empty_snapshot_repaired";
        }
      }
    } catch (error) {
      const classified = classifyDatabaseError(error);
      logDbRouteFailure(classified);
      failureClass = classified.category;
      const stale = pickStaleCache(state, key);
      if (stale) {
        applyResolvedPayload(stale, "stale", "stale");
        degradedReason = isTimeoutError(error)
          ? `timeout_stale_cache_${classified.category}`
          : `error_stale_cache_${classified.category}`;
      } else if (shouldShortCircuitDbFallback(classified.category) || isTimeoutError(error)) {
        // Pool/timeout dalgalanmasında önce en ucuz güvenli fallback'i dene (persisted cache).
        const persisted = await readPersistedScoresPayload(mode, categoryCode);
        if (persisted) {
          applyResolvedPayload(persisted, "db-cache", "db-cache");
          degradedReason = isTimeoutError(error)
            ? `timeout_db_cache_fast_${classified.category}`
            : `error_db_cache_fast_${classified.category}`;
        } else {
          const fundsListFallback = await readFundsListFallback(mode, categoryCode, queryTrim);
          if (hasUsableScoresPayload(fundsListFallback)) {
            applyResolvedPayload(fundsListFallback, "funds-list", "funds-list");
            degradedReason = isTimeoutError(error)
              ? `timeout_funds_list_fast_${classified.category}`
              : `error_funds_list_fast_${classified.category}`;
          } else {
            const scoresCacheFallback = await readPersistedAllScoresFilteredFallback(mode, categoryCode, queryTrim);
            if (hasUsableScoresPayload(scoresCacheFallback)) {
              applyResolvedPayload(scoresCacheFallback, "db-cache", "db-cache");
              degradedReason = isTimeoutError(error)
                ? `timeout_scores_cache_fast_${classified.category}`
                : `error_scores_cache_fast_${classified.category}`;
            } else {
              const servingFallback = await readCoreServingScoresFallback(mode, categoryCode, limit).catch(() => null);
              if (hasUsableScoresPayload(servingFallback)) {
                applyResolvedPayload(servingFallback, "light", "light");
                degradedReason = isTimeoutError(error)
                  ? `timeout_core_serving_fallback_${classified.category}`
                  : `error_core_serving_fallback_${classified.category}`;
              } else {
                applyResolvedPayload(buildEmptyPayload(mode), "empty", "empty");
                degradedReason = isTimeoutError(error)
                  ? `timeout_empty_fast_${classified.category}`
                  : `error_empty_fast_${classified.category}`;
              }
            }
          }
        }
        console.warn(
          `[scores-api][fast-degrade] mode=${mode} category=${categoryCode || "all"} timeout=${isTimeoutError(error) ? 1 : 0} class=${classified.category} retryable=${
            classified.retryable ? 1 : 0
          } fallback_rows=${basePayload.funds.length} fallback_source=${source}`
        );
      } else {
        const persisted = await readPersistedScoresPayload(mode, categoryCode);
        if (persisted) {
          applyResolvedPayload(persisted, "db-cache", "db-cache");
          degradedReason = isTimeoutError(error) ? "timeout_db_cache" : "error_db_cache";
        } else {
          const light = await readLightSnapshotFallback(mode, categoryCode);
          if (light) {
            applyResolvedPayload(light, "light", "light");
            degradedReason = isTimeoutError(error) ? "timeout_light_fallback" : "error_light_fallback";
          } else {
            const scoresCacheFallback = await readPersistedAllScoresFilteredFallback(mode, categoryCode, queryTrim);
            if (hasUsableScoresPayload(scoresCacheFallback)) {
              applyResolvedPayload(scoresCacheFallback, "db-cache", "db-cache");
              degradedReason = isTimeoutError(error)
                ? "timeout_scores_cache_fallback"
                : "error_scores_cache_fallback";
            } else {
              const fundsListFallback = await readFundsListFallback(mode, categoryCode, queryTrim);
              if (fundsListFallback) {
                applyResolvedPayload(fundsListFallback, "funds-list", "funds-list");
                degradedReason = isTimeoutError(error) ? "timeout_funds_list_fallback" : "error_funds_list_fallback";
              } else {
                applyResolvedPayload(buildEmptyPayload(mode), "empty", "empty");
                degradedReason = isTimeoutError(error) ? "timeout_empty" : "error_empty";
              }
            }
          }
        }
      }
    }
  }

  const queryPayload = queryTrim ? filterScoresPayloadByQuery(basePayload, queryTrim) : basePayload;
  let payload = filterScoresPayloadByTheme(queryPayload, theme);
  if (theme && payload.funds.length === 0) {
    const themeFallback = await readThemeFundsListFallback(mode, categoryCode, theme, queryTrim);
    if (hasUsableScoresPayload(themeFallback)) {
      payload = themeFallback;
      source = "funds-list";
      cacheState = "funds-list";
      degradedReason = degradedReason
        ? `${degradedReason}_theme_funds_list_fallback`
        : "theme_funds_list_fallback";
    }
  }
  if (limit != null && limit > 0) {
    payload = applyScoresPayloadRowLimit(payload, limit);
  }
  const durationMs = Date.now() - startedAt;
  const emptyResultKind =
    payload.funds.length === 0 ? (degradedReason ? "degraded" : "valid") : null;
  const discoveryHealth = deriveDiscoveryHealth({
    payload,
    scope: {
      mode,
      categoryCode,
      theme,
      queryTrim,
    },
    source,
    degradedReason,
    failureClass,
    stale: (degradedReason ?? "").includes("stale"),
    requestConsistent: true,
  });
  const scopeAligned = discoveryHealth.scopeHealth === "healthy";
  const reliability = evaluateDiscoveryReliability({
    sourceTier: reliabilitySourceFromDiscoverySource(source),
    stale: (degradedReason ?? "").includes("stale"),
    rows: payload.funds.length,
    total: payload.matchedTotal ?? payload.total,
    scopeAligned,
    degradedReason,
    failureClass,
  });
  const contractCheck = validateScoresApiPayloadContract(payload);
  if (!contractCheck.valid) {
    guardSemanticInvariant({
      scope: "scores_api_contract",
      reason: contractCheck.reason ?? "unknown",
      payload: {
        mode,
        categoryCode,
        theme,
        queryTrim,
        source,
        returnedCount: payload.funds.length,
        matchedTotal: payload.matchedTotal,
        universeTotal: payload.universeTotal,
      },
    });
  }
  const surfaceState = resolveScoresApiSurfaceState({
    payload,
    degradedReason,
  });
  if (payload.funds.length > 0 && String(cacheState) !== "stale") {
    state.cache.set(key, { payload: coerceScoresPayloadFromLegacy(payload), updatedAt: Date.now() });
  }

  console.info(
    `[scores-api] mode=${mode} category=${categoryCode || "all"} limit=${limit ?? "none"} q=${queryTrim ? "1" : "0"} ` +
      `source=${source} cache=${cacheState} universe=${payload.universeTotal} matched=${payload.matchedTotal} returned=${payload.returnedCount} ms=${durationMs}${
        degradedReason ? ` degraded=${degradedReason}` : ""
      }${
        failureClass ? ` failure_class=${failureClass}` : ""
      }`
  );
  logDbAccessResolution(
    buildDbAccessResolutionLog({
      route: "/api/funds/scores",
      effectiveDatasourceUrl: dbConnProfile.effectiveDatasourceUrl,
      envPath: dbConnProfile.envPath,
      prismaRuntimeEnvKey: dbConnProfile.prismaRuntimeEnvKey,
      connectionMode: dbConnProfile.connectionMode,
      chosenDataSource: source,
      degraded: Boolean(degradedReason),
      degradedReason,
      dbFailureCategory: failureClass,
    })
  );
  console.info(
    `[discover-server-result] mode=${mode} category=${categoryCode || "all"} theme=${theme ?? "none"} ` +
      `source=${source} cache=${cacheState} base_count=${basePayload.funds.length} query_count=${queryPayload.funds.length} ` +
      `server_result_count=${payload.funds.length} universe=${payload.universeTotal} matched=${payload.matchedTotal} ms=${durationMs} empty_reason=${
        payload.funds.length === 0 ? degradedReason ?? "valid_empty" : "none"
      }`
  );
  console.info(
    `[discover-universe-total] mode=${mode} category=${categoryCode || "all"} theme=${theme ?? "none"} ` +
      `universe=${payload.universeTotal} matched=${payload.matchedTotal} returned=${payload.returnedCount} base_universe=${basePayload.universeTotal} source=${source}`
  );

  return NextResponse.json(
    {
      ...payload,
      meta: {
        servingWorld,
        surfaceState,
        reliability: {
          overall: discoveryHealth.overallDiscoveryHealth,
          scope: discoveryHealth.scopeHealth,
          trustAsFinal: discoveryHealth.trustAsFinal,
        },
      },
    },
    {
    status: 200,
    headers: {
      "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
      "X-Scores-Source": source,
      "X-Scores-Cache": cacheState,
      "X-Scores-Surface-State": surfaceState,
      "X-Discover-Theme": theme ?? "none",
      "X-Discover-Server-Result-Count": String(payload.funds.length),
      "X-Discover-Universe-Total": String(payload.universeTotal),
      "X-Db-Failure-Class": failureClass ?? "none",
      ...dbHeaders,
      ...(emptyResultKind ? { "X-Scores-Empty-Result": emptyResultKind } : {}),
      ...(degradedReason ? { "X-Scores-Degraded": degradedReason } : {}),
      ...(failureClass ? { "X-Scores-Failure-Class": failureClass } : {}),
      "X-Discovery-Reliability-Class": discoveryHealth.reliabilityClass,
      "X-Discovery-Trust-Final": discoveryHealth.trustAsFinal ? "1" : "0",
      "X-Discovery-Scope-Aligned": scopeAligned ? "1" : "0",
      "X-Discovery-Source-Tier": reliability.sourceTier,
      "X-Discovery-Reliability-Reasons": discoveryHealth.reasons.join(",") || "none",
      "X-Discovery-Scope-Health": discoveryHealth.scopeHealth,
      "X-Discovery-Completeness-Health": discoveryHealth.resultCompletenessHealth,
      "X-Discovery-Freshness-Health": discoveryHealth.freshnessHealth,
      "X-Discovery-Request-Health": discoveryHealth.requestConsistencyHealth,
      "X-Discovery-Overall-Health": discoveryHealth.overallDiscoveryHealth,
      "X-Discovery-Request-Key": scopeRequestKey,
      "X-Serving-World-Id": servingWorld?.worldId ?? "none",
      "X-Serving-World-Aligned": servingWorld?.worldAligned ? "1" : "0",
      "X-Serving-FundList-Build-Id": servingWorld?.buildIds.fundList ?? "none",
      "X-Serving-Discovery-Build-Id": servingWorld?.buildIds.discovery ?? "none",
      ...servingStrictHeaders({ enabled: strictMode, violated: false }),
    },
  }
  );
}

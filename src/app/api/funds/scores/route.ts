import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import type { RankingMode } from "@/lib/scoring";
import type { ScoresApiPayload } from "@/lib/services/fund-scores-types";
import { getScoresPayloadFromDailySnapshot } from "@/lib/services/fund-daily-snapshot.service";
import { filterScoresPayloadByQuery } from "@/lib/services/fund-scores-compute.service";
import { scoresApiCacheKey } from "@/lib/services/fund-scores-cache.service";
import { prisma } from "@/lib/prisma";
import { getFundsPage } from "@/lib/services/fund-list.service";
import { classifyDatabaseError } from "@/lib/database-error-classifier";
import { fundMatchesTheme, parseFundThemeParam, type FundThemeId } from "@/lib/fund-themes";
import { getFundDetailCoreServingUniversePayloads } from "@/lib/services/fund-detail-core-serving.service";

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
const SCORES_LIGHT_FALLBACK_TIMEOUT_MS = parseEnvMs("SCORES_LIGHT_FALLBACK_TIMEOUT_MS", 1_500, 600, 6_000);
const SCORES_FUNDS_LIST_FALLBACK_TIMEOUT_MS = parseEnvMs("SCORES_FUNDS_LIST_FALLBACK_TIMEOUT_MS", 1_000, 500, 6_000);
const SCORES_LIGHT_FALLBACK_LIMIT = 300;

type ScoresCacheEntry = {
  payload: ScoresApiPayload;
  updatedAt: number;
};

type ScoresRuntimeState = {
  cache: Map<string, ScoresCacheEntry>;
  inflight: Map<string, Promise<ScoresApiPayload>>;
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

function filterScoresPayloadByTheme(payload: ScoresApiPayload, theme: FundThemeId | null): ScoresApiPayload {
  if (!theme) return payload;
  const funds = payload.funds.filter((fund) => fundMatchesTheme(fund, theme));
  return { ...payload, total: funds.length, funds };
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
    category === "network_unreachable"
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
  return { mode, total: 0, funds: [] };
}

function sanitizePersistedPayload(mode: RankingMode, payload: unknown): ScoresApiPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const candidate = payload as ScoresApiPayload;
  if (!Array.isArray(candidate.funds)) return null;
  return {
    mode,
    total: typeof candidate.total === "number" ? candidate.total : candidate.funds.length,
    funds: candidate.funds,
    ...(typeof candidate.appliedQuery === "string" && candidate.appliedQuery.trim()
      ? { appliedQuery: candidate.appliedQuery }
      : {}),
  };
}

function pickFreshCache(state: ScoresRuntimeState, key: string): ScoresApiPayload | null {
  const hit = state.cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.updatedAt > SCORES_FRESH_TTL_MS) return null;
  return hit.payload;
}

function pickStaleCache(state: ScoresRuntimeState, key: string): ScoresApiPayload | null {
  const hit = state.cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.updatedAt > SCORES_STALE_TTL_MS) return null;
  return hit.payload;
}

async function readPersistedScoresPayload(mode: RankingMode, categoryCode: string): Promise<ScoresApiPayload | null> {
  const cacheKey = scoresApiCacheKey(mode, categoryCode, "");
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

async function readFundsListFallback(mode: RankingMode, categoryCode: string): Promise<ScoresApiPayload | null> {
  const page = await withTimeout(
    getFundsPage({
      page: 1,
      pageSize: SCORES_LIGHT_FALLBACK_LIMIT,
      q: "",
      category: categoryCode || undefined,
      fundType: undefined,
      sortField: "portfolioSize",
      sortDir: "desc",
    }),
    SCORES_FUNDS_LIST_FALLBACK_TIMEOUT_MS
  ).catch(() => null);
  if (!page) return null;
  return {
    mode,
    total: page.total,
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
  };
}

async function readCoreServingScoresFallback(
  mode: RankingMode,
  categoryCode: string,
  limit: number | null
): Promise<ScoresApiPayload | null> {
  const requestedLimit = Math.max(limit ?? SCORES_LIGHT_FALLBACK_LIMIT, SCORES_LIGHT_FALLBACK_LIMIT);
  const serving = await getFundDetailCoreServingUniversePayloads();
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
  return {
    mode,
    total: rows.length,
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
  };
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
    state.cache.set(key, { payload, updatedAt: Date.now() });
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
  const { searchParams } = new URL(request.url);
  const mode = normalizeRankingMode(searchParams);
  const categoryCode = (searchParams.get("category") ?? "").trim().slice(0, MAX_CATEGORY_LENGTH);
  const theme = parseFundThemeParam(searchParams.get("theme") ?? "");
  const queryTrim = (searchParams.get("q") ?? searchParams.get("query") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const limit = parseLimit(searchParams);
  const key = baseScoresKey(mode, categoryCode, limit);
  const state = getScoresRouteState();

  let cacheState: "hit" | "miss" | "dedupe" | "stale" | "db-cache" | "light" | "funds-list" | "empty" = "miss";
  let source: "snapshot" | "stale" | "db-cache" | "light" | "funds-list" | "empty" = "snapshot";
  let degradedReason: string | null = null;
  let failureClass: string | null = null;
  let basePayload: ScoresApiPayload;

  console.info(
    `[discover-server-query] mode=${mode} category=${categoryCode || "all"} theme=${theme ?? "none"} ` +
      `limit=${limit ?? "none"} q=${queryTrim ? "1" : "0"}`
  );

  try {
    const resolved = await resolveBasePayload(mode, categoryCode, limit);
    basePayload = resolved.payload;
    cacheState = resolved.cacheState;
  } catch (error) {
    const classified = classifyDatabaseError(error);
    failureClass = classified.category;
    const stale = pickStaleCache(state, key);
    if (stale) {
      basePayload = stale;
      cacheState = "stale";
      source = "stale";
      degradedReason = isTimeoutError(error)
        ? `timeout_stale_cache_${classified.category}`
        : `error_stale_cache_${classified.category}`;
    } else if (shouldShortCircuitDbFallback(classified.category) || isTimeoutError(error)) {
      const servingFallback = await readCoreServingScoresFallback(mode, categoryCode, limit).catch(() => null);
      if (servingFallback) {
        basePayload = servingFallback;
        cacheState = "light";
        source = "light";
        degradedReason = isTimeoutError(error)
          ? `timeout_core_serving_fallback_${classified.category}`
          : `error_core_serving_fallback_${classified.category}`;
      } else {
        // DB pool/connection baskısında ek DB fallback sorguları zincirleme yük üretiyor.
        // Bu durumda yalnızca file/memory serving fallback de yoksa hızlı-degrade döneriz.
        basePayload = buildEmptyPayload(mode);
        cacheState = "empty";
        source = "empty";
        degradedReason = isTimeoutError(error)
          ? `timeout_empty_fast_${classified.category}`
          : `error_empty_fast_${classified.category}`;
      }
      console.warn(
        `[scores-api][fast-degrade] mode=${mode} category=${categoryCode || "all"} timeout=${isTimeoutError(error) ? 1 : 0} class=${classified.category} retryable=${
          classified.retryable ? 1 : 0
        } fallback_rows=${basePayload.funds.length} fallback_source=${source}`
      );
    } else {
      const persisted = await readPersistedScoresPayload(mode, categoryCode);
      if (persisted) {
        basePayload = persisted;
        cacheState = "db-cache";
        source = "db-cache";
        degradedReason = isTimeoutError(error) ? "timeout_db_cache" : "error_db_cache";
      } else {
        const light = await readLightSnapshotFallback(mode, categoryCode);
        if (light) {
          basePayload = light;
          cacheState = "light";
          source = "light";
          degradedReason = isTimeoutError(error) ? "timeout_light_fallback" : "error_light_fallback";
        } else {
          const fundsListFallback = await readFundsListFallback(mode, categoryCode);
          if (fundsListFallback) {
            basePayload = fundsListFallback;
            cacheState = "funds-list";
            source = "funds-list";
            degradedReason = isTimeoutError(error) ? "timeout_funds_list_fallback" : "error_funds_list_fallback";
          } else {
            basePayload = buildEmptyPayload(mode);
            cacheState = "empty";
            source = "empty";
            degradedReason = isTimeoutError(error) ? "timeout_empty" : "error_empty";
          }
        }
      }
    }
  }

  const queryPayload = queryTrim ? filterScoresPayloadByQuery(basePayload, queryTrim) : basePayload;
  const payload = filterScoresPayloadByTheme(queryPayload, theme);
  const durationMs = Date.now() - startedAt;
  const emptyResultKind =
    payload.funds.length === 0 ? (degradedReason ? "degraded" : "valid") : null;

  console.info(
    `[scores-api] mode=${mode} category=${categoryCode || "all"} limit=${limit ?? "none"} q=${queryTrim ? "1" : "0"} ` +
      `source=${source} cache=${cacheState} total=${payload.total} ms=${durationMs}${degradedReason ? ` degraded=${degradedReason}` : ""}${
        failureClass ? ` failure_class=${failureClass}` : ""
      }`
  );
  console.info(
    `[discover-server-result] mode=${mode} category=${categoryCode || "all"} theme=${theme ?? "none"} ` +
      `source=${source} cache=${cacheState} base_count=${basePayload.funds.length} query_count=${queryPayload.funds.length} ` +
      `server_result_count=${payload.funds.length} total=${payload.total} ms=${durationMs} empty_reason=${
        payload.funds.length === 0 ? degradedReason ?? "valid_empty" : "none"
      }`
  );
  console.info(
    `[discover-universe-total] mode=${mode} category=${categoryCode || "all"} theme=${theme ?? "none"} ` +
      `visible_total=${payload.total} base_total=${basePayload.total} source=${source}`
  );

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
      "X-Scores-Source": source,
      "X-Scores-Cache": cacheState,
      "X-Discover-Theme": theme ?? "none",
      "X-Discover-Server-Result-Count": String(payload.funds.length),
      "X-Discover-Universe-Total": String(payload.total),
      ...(emptyResultKind ? { "X-Scores-Empty-Result": emptyResultKind } : {}),
      ...(degradedReason ? { "X-Scores-Degraded": degradedReason } : {}),
      ...(failureClass ? { "X-Scores-Failure-Class": failureClass } : {}),
    },
  });
}

import { NextResponse } from "next/server";
import { getMarketSummaryFromDailySnapshot } from "@/lib/services/fund-daily-snapshot.service";
import type { MarketSnapshotSummaryPayload } from "@/lib/services/fund-daily-snapshot.service";
import { classifyDatabaseError } from "@/lib/database-error-classifier";
import { getDbEnvStatus, sanitizeFailureDetail } from "@/lib/db-env-validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = ["fra1"];

const MARKET_TIMEOUT_MS = parseEnvMs("MARKET_ROUTE_TIMEOUT_MS", 4_000, 1_200, 10_000);
const MARKET_CACHE_TTL_MS = parseEnvMs("MARKET_ROUTE_CACHE_TTL_MS", 60_000, 5_000, 10 * 60_000);
const MARKET_STALE_TTL_MS = parseEnvMs("MARKET_ROUTE_STALE_TTL_MS", 10 * 60_000, 20_000, 60 * 60_000);

type MarketRouteCacheEntry = {
  payload: MarketSnapshotSummaryPayload;
  updatedAt: number;
};

type MarketRouteState = {
  cache?: MarketRouteCacheEntry;
  inflight?: Promise<MarketSnapshotSummaryPayload | null>;
};

function parseEnvMs(name: string, fallback: number, min: number, max: number): number {
  const rawValue = process.env[name];
  if (typeof rawValue !== "string" || rawValue.trim() === "") return fallback;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`market_timeout_${timeoutMs}ms`)), timeoutMs);
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

function getMarketRouteState(): MarketRouteState {
  const g = globalThis as typeof globalThis & { __marketRouteState?: MarketRouteState };
  if (!g.__marketRouteState) g.__marketRouteState = {};
  return g.__marketRouteState;
}

function shouldDegradeForDbCategory(category: string): boolean {
  return (
    category === "pool_checkout_timeout" ||
    category === "query_execution_timeout" ||
    category === "transaction_timeout" ||
    category === "connection_closed" ||
    category === "connect_timeout" ||
    category === "network_unreachable"
  );
}

function isMarketTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("market_timeout_");
}

function buildMarketFallbackPayload(): MarketSnapshotSummaryPayload {
  return {
    summary: { avgDailyReturn: 0, totalFundCount: 0 },
    fundCount: 0,
    totalPortfolioSize: 0,
    totalInvestorCount: 0,
    advancers: 0,
    decliners: 0,
    unchanged: 0,
    lastSyncedAt: null,
    snapshotDate: null,
    usdTry: null,
    eurTry: null,
    topGainers: [],
    topLosers: [],
    formatted: {
      totalPortfolioSize: "₺0",
      totalInvestorCount: "0",
    },
  };
}

export async function GET() {
  const startedAt = Date.now();
  const dbEnvStatus = getDbEnvStatus();
  const dbHeaders = {
    "X-Db-Env-Status": dbEnvStatus.failureCategory ?? "ok",
    "X-Db-Connection-Mode": dbEnvStatus.connectionMode,
  };
  const state = getMarketRouteState();
  const cached = state.cache;
  if (cached && Date.now() - cached.updatedAt <= MARKET_CACHE_TTL_MS) {
    return NextResponse.json(cached.payload, {
      headers: {
        "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
        "X-Market-Cache": "hit",
        "X-Market-Failure-Class": "none",
        "X-Market-Fallback-Used": "0",
        "X-Db-Failure-Class": "none",
        ...dbHeaders,
      },
    });
  }

  try {
    const task = state.inflight ?? withTimeout(getMarketSummaryFromDailySnapshot(), MARKET_TIMEOUT_MS);
    state.inflight = task;
    const payload = await task;
    state.inflight = undefined;
    if (!payload) {
      console.warn("[api/market] payload_empty reason=summary_null");
      return NextResponse.json({ error: "market_empty" }, { status: 404 });
    }
    console.info(
      `[api/market] source=primary fallback_used=0 fund_count=${payload.fundCount} portfolio=${Math.round(
        payload.totalPortfolioSize
      )} investor=${Math.round(payload.totalInvestorCount)}`
    );
    state.cache = { payload, updatedAt: Date.now() };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
        "X-Market-Cache": "miss",
        "X-Market-Failure-Class": "none",
        "X-Market-Fallback-Used": "0",
        "X-Db-Failure-Class": "none",
        ...dbHeaders,
      },
    });
  } catch (e) {
    state.inflight = undefined;
    const classified = classifyDatabaseError(e);
    const marketFailureClass = isMarketTimeoutError(e) ? "route_timeout" : classified.category;
    const marketFallbackEligible = isMarketTimeoutError(e) || shouldDegradeForDbCategory(classified.category);
    const stale = state.cache;
    if (stale && Date.now() - stale.updatedAt <= MARKET_STALE_TTL_MS) {
      console.warn(
        `[api/market] stale_fallback market_failure_class=${marketFailureClass} market_fallback_used=1 retryable=${classified.retryable ? 1 : 0} ms=${
          Date.now() - startedAt
        }`
      );
      return NextResponse.json(stale.payload, {
        status: 200,
        headers: {
          "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
          "X-Market-Cache": "stale",
          "X-Market-Degraded": marketFailureClass,
          "X-Market-Failure-Class": marketFailureClass,
          "X-Market-Fallback-Used": "1",
          "X-Db-Failure-Class": marketFailureClass,
          ...dbHeaders,
        },
      });
    }
    if (marketFallbackEligible) {
      console.warn(
        `[api/market] empty_fallback market_failure_class=${marketFailureClass} market_fallback_used=1 retryable=${classified.retryable ? 1 : 0} ms=${
          Date.now() - startedAt
        }`
      );
      return NextResponse.json(buildMarketFallbackPayload(), {
        status: 200,
        headers: {
          "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
          "X-Market-Cache": "empty",
          "X-Market-Degraded": marketFailureClass,
          "X-Market-Failure-Class": marketFailureClass,
          "X-Market-Fallback-Used": "1",
          "X-Db-Failure-Class": marketFailureClass,
          ...dbHeaders,
        },
      });
    }
    console.error("[db-route-failure]", {
      route: "/api/market",
      marketFailureClass,
      envConfigured: dbEnvStatus.configured,
      dbEnvStatus: dbEnvStatus.failureCategory ?? "ok",
      connectionMode: dbEnvStatus.connectionMode,
      prismaCode: classified.prismaCode,
      retryable: classified.retryable,
      message: sanitizeFailureDetail(classified.message),
      timestamp: new Date().toISOString(),
    });
    const devDetail = process.env.NODE_ENV !== "production" && e instanceof Error ? e.message : undefined;
    return NextResponse.json(
      { error: "market_failed", ...(devDetail ? { detail: devDetail } : {}) },
      {
        status: 500,
        headers: {
          "X-Market-Failure-Class": marketFailureClass,
          "X-Market-Fallback-Used": "0",
          "X-Db-Failure-Class": marketFailureClass,
          ...dbHeaders,
        },
      }
    );
  }
}

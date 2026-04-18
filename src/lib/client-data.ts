import type { RankingMode } from "@/lib/scoring";
import type {
  FundListCategoryOption,
  FundListRow,
  FundListTypeOption,
} from "@/lib/services/fund-list.service";
import type { ScoredFund, ScoredResponse } from "@/types/scored-funds";

type JsonRecord = Record<string, unknown>;

export interface MarketApiPayload {
  summary: { avgDailyReturn: number; totalFundCount: number };
  fundCount: number;
  /** False when fundCount is a subset shell (serving preview); must not be labeled as full universe. */
  snapshotFundCountIsCanonicalUniverse?: boolean;
  totalPortfolioSize: number;
  totalInvestorCount: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  lastSyncedAt: string | null;
  snapshotDate: string | null;
  usdTry: number | null;
  eurTry: number | null;
  topGainers: Array<{
    code: string;
    name: string;
    shortName: string | null;
    lastPrice: number;
    dailyReturn: number;
    portfolioSize: number;
  }>;
  topLosers: Array<{
    code: string;
    name: string;
    shortName: string | null;
    lastPrice: number;
    dailyReturn: number;
    portfolioSize: number;
  }>;
  formatted: {
    totalPortfolioSize: string;
    totalInvestorCount: string;
  };
}

export interface MarketCategoryRow {
  id: string;
  code: string;
  name: string;
  color: string | null;
  fundCount: number;
  avgDailyReturn: number;
  totalPortfolioSize: number;
}

export interface StocksResponsePayload {
  items: Array<{
    id: string;
    symbol: string;
    name: string;
    shortName: string | null;
    logoUrl: string | null;
    marketCap: number;
    lastPrice: number;
    previousClose: number | null;
    change: number;
    changePercent: number;
    dayHigh: number;
    dayLow: number;
    volume: number;
    turnover: number;
    peRatio: number | null;
    sparkline?: number[];
    sparklineTrend?: "up" | "down" | "flat";
    sector: {
      code: string;
      name: string;
      color: string | null;
    } | null;
  }>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SparklineApiPayload {
  ok: true;
  items: Record<string, { points: number[]; trend: "up" | "down" | "flat" }>;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumber(value: unknown, fallback = 0): number {
  return readFiniteNumber(value) ?? fallback;
}

function normalizeCategory(
  value: unknown
): { code: string; name: string; color: string | null } | null {
  if (!isRecord(value)) return null;
  const code = readString(value.code);
  const name = readString(value.name);
  if (!code || !name) return null;
  return {
    code,
    name,
    color: readNullableString(value.color),
  };
}

function normalizeFundType(value: unknown): { code: number; name: string } | null {
  if (!isRecord(value)) return null;
  const code = readFiniteNumber(value.code);
  const name = readString(value.name);
  if (code == null || !name) return null;
  return { code, name };
}

function normalizeFundListRow(value: unknown): FundListRow | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const code = readString(value.code);
  const name = readString(value.name);
  if (!id || !code || !name) return null;
  return {
    id,
    code,
    name,
    shortName: readNullableString(value.shortName),
    logoUrl: readNullableString(value.logoUrl),
    portfolioSize: readNumber(value.portfolioSize),
    lastPrice: readNumber(value.lastPrice),
    dailyReturn: readNumber(value.dailyReturn),
    weeklyReturn: readNumber(value.weeklyReturn),
    monthlyReturn: readNumber(value.monthlyReturn),
    yearlyReturn: readNumber(value.yearlyReturn),
    investorCount: readNumber(value.investorCount),
    shareCount: readNumber(value.shareCount),
    category: normalizeCategory(value.category),
    fundType: normalizeFundType(value.fundType),
  };
}

function normalizeScoredFund(value: unknown): ScoredFund | null {
  if (!isRecord(value)) return null;
  const fundId = readString(value.fundId);
  const code = readString(value.code);
  const name = readString(value.name);
  const finalScoreRaw = value.finalScore;
  const finalScore =
    finalScoreRaw === null || finalScoreRaw === undefined ? null : readFiniteNumber(finalScoreRaw);
  if (!fundId || !code || !name) return null;
  return {
    fundId,
    code,
    name,
    shortName: readNullableString(value.shortName),
    logoUrl: readNullableString(value.logoUrl),
    lastPrice: readNumber(value.lastPrice),
    dailyReturn: readNumber(value.dailyReturn),
    portfolioSize: readNumber(value.portfolioSize),
    investorCount: readNumber(value.investorCount),
    category: (() => {
      const category = normalizeCategory(value.category);
      return category ? { code: category.code, name: category.name } : null;
    })(),
    fundType: normalizeFundType(value.fundType),
    finalScore,
  };
}

function normalizeRankingMode(value: unknown): RankingMode {
  if (value === "LOW_RISK" || value === "HIGH_RETURN" || value === "STABLE") return value;
  return "BEST";
}

function normalizeMarketMover(
  value: unknown
): {
  code: string;
  name: string;
  shortName: string | null;
  lastPrice: number;
  dailyReturn: number;
  portfolioSize: number;
} | null {
  if (!isRecord(value)) return null;
  const code = readString(value.code);
  const name = readString(value.name);
  if (!code || !name) return null;
  return {
    code,
    name,
    shortName: readNullableString(value.shortName),
    lastPrice: readNumber(value.lastPrice),
    dailyReturn: readNumber(value.dailyReturn),
    portfolioSize: readNumber(value.portfolioSize),
  };
}

function normalizeStocksRow(
  value: unknown
): StocksResponsePayload["items"][number] | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const symbol = readString(value.symbol);
  const name = readString(value.name);
  if (!id || !symbol || !name) return null;
  const sparklineTrend =
    value.sparklineTrend === "up" || value.sparklineTrend === "down" || value.sparklineTrend === "flat"
      ? value.sparklineTrend
      : undefined;
  const sparkline = Array.isArray(value.sparkline)
    ? value.sparkline.filter((point): point is number => typeof point === "number" && Number.isFinite(point))
    : undefined;

  return {
    id,
    symbol,
    name,
    shortName: readNullableString(value.shortName),
    logoUrl: readNullableString(value.logoUrl),
    marketCap: readNumber(value.marketCap),
    lastPrice: readNumber(value.lastPrice),
    previousClose: readFiniteNumber(value.previousClose),
    change: readNumber(value.change),
    changePercent: readNumber(value.changePercent),
    dayHigh: readNumber(value.dayHigh),
    dayLow: readNumber(value.dayLow),
    volume: readNumber(value.volume),
    turnover: readNumber(value.turnover),
    peRatio: readFiniteNumber(value.peRatio),
    sparkline,
    sparklineTrend,
    sector: normalizeCategory(value.sector),
  };
}

export async function fetchNormalizedJson<T>(
  url: string,
  label: string,
  normalize: (value: unknown) => T | null,
  init?: RequestInit,
  timeoutMs = 12_000
): Promise<T> {
  const externalSignal = init?.signal;
  const controller = new AbortController();
  const onExternalAbort = () => {
    controller.abort(new DOMException("request_aborted", "AbortError"));
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      onExternalAbort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`request_timeout_${timeoutMs}ms`, "AbortError"));
  }, timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${label}: HTTP ${response.status}${text ? ` - ${text.slice(0, 200)}` : ""}`);
    }

    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`${label}: geçersiz JSON`);
    }

    const normalized = normalize(json);
    if (normalized == null) {
      throw new Error(`${label}: beklenen formatta değil`);
    }
    return normalized;
  } catch (error) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new Error(`${label}: istek zaman aşımına uğradı (${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

export type NormalizedJsonFetchWithMeta<T> = {
  data: T;
  status: number;
  headers: Headers;
  rawBytes: number;
};

type SharedScoresFetch = {
  status: number;
  headers: Array<[string, string]>;
  text: string;
  rawBytes: number;
};

const SHARED_SCORES_SETTLED_TTL_MS = 2_000;
const sharedScoresFetches = new Map<string, Promise<SharedScoresFetch>>();
const sharedScoresSettled = new Map<string, { value: SharedScoresFetch; updatedAt: number }>();

function sharedScoresFetchKey(url: string, init?: RequestInit): string | null {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" || init?.body) return null;
  const parsed = new URL(url, "http://localhost");
  if (parsed.pathname !== "/api/funds/scores") return null;
  const sortedParams = [...parsed.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyCompare = leftKey.localeCompare(rightKey);
    if (keyCompare !== 0) return keyCompare;
    return leftValue.localeCompare(rightValue);
  });
  return `${parsed.pathname}?${new URLSearchParams(sortedParams).toString()}`;
}

function abortPromise(signal: AbortSignal | undefined): Promise<never> | null {
  if (!signal) return null;
  if (signal.aborted) {
    return Promise.reject(new DOMException("request_aborted", "AbortError"));
  }
  return new Promise((_, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("request_aborted", "AbortError")),
      { once: true }
    );
  });
}

function runSharedScoresFetch(
  url: string,
  label: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<SharedScoresFetch> {
  const key = sharedScoresFetchKey(url, init);
  if (!key) {
    return Promise.reject(new Error("not_shareable_scores_fetch"));
  }
  const settled = sharedScoresSettled.get(key);
  if (settled && Date.now() - settled.updatedAt <= SHARED_SCORES_SETTLED_TTL_MS) {
    return Promise.resolve(settled.value);
  }
  if (settled) sharedScoresSettled.delete(key);
  const existing = sharedScoresFetches.get(key);
  if (existing) return existing;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`request_timeout_${timeoutMs}ms`, "AbortError"));
  }, timeoutMs);
  const { signal: _signal, ...safeInit } = init ?? {};
  const request = fetch(url, { ...safeInit, signal: controller.signal })
    .then(async (response) => {
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${label}: HTTP ${response.status}${text ? ` - ${text.slice(0, 200)}` : ""}`);
      }
      const value = {
        status: response.status,
        headers: [...response.headers.entries()],
        text,
        rawBytes: typeof TextEncoder !== "undefined" ? new TextEncoder().encode(text).length : text.length,
      };
      sharedScoresSettled.set(key, { value, updatedAt: Date.now() });
      return value;
    })
    .catch((error) => {
      if (controller.signal.aborted) {
        throw new Error(`${label}: istek zaman aşımına uğradı (${timeoutMs}ms)`);
      }
      throw error;
    })
    .finally(() => {
      clearTimeout(timer);
      sharedScoresFetches.delete(key);
    });
  sharedScoresFetches.set(key, request);
  return request;
}

export async function fetchNormalizedJsonWithMeta<T>(
  url: string,
  label: string,
  normalize: (value: unknown) => T | null,
  init?: RequestInit,
  timeoutMs = 12_000
): Promise<NormalizedJsonFetchWithMeta<T>> {
  const sharedKey = sharedScoresFetchKey(url, init);
  if (sharedKey) {
    const externalSignal = init?.signal ?? undefined;
    const abort = abortPromise(externalSignal);
    const shared = runSharedScoresFetch(url, label, init, timeoutMs);
    const raw = await (abort ? Promise.race([shared, abort]) : shared);
    let json: unknown;
    try {
      json = raw.text ? JSON.parse(raw.text) : null;
    } catch {
      throw new Error(`${label}: geçersiz JSON`);
    }
    const normalized = normalize(json);
    if (normalized == null) {
      throw new Error(`${label}: beklenen formatta değil`);
    }
    return {
      data: normalized,
      status: raw.status,
      headers: new Headers(raw.headers),
      rawBytes: raw.rawBytes,
    };
  }

  const externalSignal = init?.signal;
  const controller = new AbortController();
  const onExternalAbort = () => {
    controller.abort(new DOMException("request_aborted", "AbortError"));
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      onExternalAbort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`request_timeout_${timeoutMs}ms`, "AbortError"));
  }, timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${label}: HTTP ${response.status}${text ? ` - ${text.slice(0, 200)}` : ""}`);
    }

    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`${label}: geçersiz JSON`);
    }

    const normalized = normalize(json);
    if (normalized == null) {
      throw new Error(`${label}: beklenen formatta değil`);
    }

    return {
      data: normalized,
      status: response.status,
      headers: response.headers,
      rawBytes: typeof TextEncoder !== "undefined" ? new TextEncoder().encode(text).length : text.length,
    };
  } catch (error) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new Error(`${label}: istek zaman aşımına uğradı (${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

export function normalizeCategoryOptions(value: unknown): FundListCategoryOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const code = readString(item.code);
      const name = readString(item.name);
      if (!code || !name) return null;
      return { code, name };
    })
    .filter((item): item is FundListCategoryOption => item !== null);
}

export function normalizeFundTypeOptions(value: unknown): FundListTypeOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const code = readFiniteNumber(item.code);
      const name = readString(item.name);
      if (code == null || !name) return null;
      return { code, name };
    })
    .filter((item): item is FundListTypeOption => item !== null);
}

export function normalizeFundListResponse(
  value: unknown
): { items: FundListRow[]; page: number; pageSize: number; total: number; totalPages: number } | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.items)) return null;
  return {
    items: value.items
      .map((item) => normalizeFundListRow(item))
      .filter((item): item is FundListRow => item !== null),
    page: readNumber(value.page, 1),
    pageSize: readNumber(value.pageSize, 0),
    total: readNumber(value.total),
    totalPages: readNumber(value.totalPages, 1),
  };
}

export function normalizeScoredResponse(value: unknown): ScoredResponse | null {
  if (!isRecord(value) || !Array.isArray(value.funds)) return null;
  const funds = value.funds
    .map((item) => normalizeScoredFund(item))
    .filter((item): item is ScoredFund => item !== null);
  const returnedCount = funds.length;
  const legacyTotal = readNumber(value.total, returnedCount);
  const universeTotal = readFiniteNumber(value.universeTotal) ?? legacyTotal;
  const matchedTotalRaw = readFiniteNumber(value.matchedTotal);
  const matchedTotal =
    matchedTotalRaw != null ? Math.max(matchedTotalRaw, returnedCount) : Math.max(legacyTotal, returnedCount);
  return {
    mode: normalizeRankingMode(value.mode),
    universeTotal,
    matchedTotal,
    returnedCount,
    total: universeTotal,
    funds,
    ...(typeof value.appliedQuery === "string" && value.appliedQuery.trim()
      ? { appliedQuery: value.appliedQuery }
      : {}),
  };
}

export function normalizeMarketApi(value: unknown): MarketApiPayload | null {
  if (!isRecord(value) || !isRecord(value.summary) || !isRecord(value.formatted)) return null;
  const avgDailyReturn = readFiniteNumber(value.summary.avgDailyReturn);
  const totalFundCount = readFiniteNumber(value.summary.totalFundCount);
  const totalPortfolioSize = readString(value.formatted.totalPortfolioSize);
  const totalInvestorCount = readString(value.formatted.totalInvestorCount);
  if (avgDailyReturn == null || totalFundCount == null || !totalPortfolioSize || !totalInvestorCount) {
    return null;
  }

  const snapshotFundCountIsCanonicalUniverse =
    typeof (value as { snapshotFundCountIsCanonicalUniverse?: unknown }).snapshotFundCountIsCanonicalUniverse ===
    "boolean"
      ? Boolean((value as { snapshotFundCountIsCanonicalUniverse: boolean }).snapshotFundCountIsCanonicalUniverse)
      : true;

  return {
    summary: {
      avgDailyReturn,
      totalFundCount,
    },
    fundCount: readNumber(value.fundCount),
    snapshotFundCountIsCanonicalUniverse,
    totalPortfolioSize: readNumber(value.totalPortfolioSize),
    totalInvestorCount: readNumber(value.totalInvestorCount),
    advancers: readNumber(value.advancers),
    decliners: readNumber(value.decliners),
    unchanged: readNumber(value.unchanged),
    lastSyncedAt: readNullableString(value.lastSyncedAt),
    snapshotDate: readNullableString(value.snapshotDate),
    usdTry: readFiniteNumber(value.usdTry),
    eurTry: readFiniteNumber(value.eurTry),
    topGainers: Array.isArray(value.topGainers)
      ? value.topGainers
          .map((item) => normalizeMarketMover(item))
          .filter((item): item is MarketApiPayload["topGainers"][number] => item !== null)
      : [],
    topLosers: Array.isArray(value.topLosers)
      ? value.topLosers
          .map((item) => normalizeMarketMover(item))
          .filter((item): item is MarketApiPayload["topLosers"][number] => item !== null)
      : [],
    formatted: {
      totalPortfolioSize,
      totalInvestorCount,
    },
  };
}

export function normalizeMarketCategoryRows(value: unknown): MarketCategoryRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const id = readString(item.id);
      const code = readString(item.code);
      const name = readString(item.name);
      if (!id || !code || !name) return null;
      return {
        id,
        code,
        name,
        color: readNullableString(item.color),
        fundCount: readNumber(item.fundCount),
        avgDailyReturn: readNumber(item.avgDailyReturn),
        totalPortfolioSize: readNumber(item.totalPortfolioSize),
      };
    })
    .filter((item): item is MarketCategoryRow => item !== null);
}

export function normalizeIndexOptions(
  value: unknown
): Array<{ code: string; name: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const code = readString(item.code);
      const name = readString(item.name);
      if (!code || !name) return null;
      return { code, name };
    })
    .filter((item): item is { code: string; name: string } => item !== null);
}

export function normalizeStocksResponse(value: unknown): StocksResponsePayload | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  return {
    items: value.items
      .map((item) => normalizeStocksRow(item))
      .filter((item): item is StocksResponsePayload["items"][number] => item !== null),
    page: readNumber(value.page, 1),
    pageSize: readNumber(value.pageSize, 50),
    total: readNumber(value.total),
    totalPages: readNumber(value.totalPages, 1),
  };
}

export function normalizeSparklineResponse(value: unknown): SparklineApiPayload | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.items)) return null;
  const items = Object.fromEntries(
    Object.entries(value.items)
      .map(([symbol, entry]) => {
        if (!isRecord(entry)) return null;
        const trend =
          entry.trend === "up" || entry.trend === "down" || entry.trend === "flat"
            ? entry.trend
            : null;
        if (!trend) return null;
        const points = Array.isArray(entry.points)
          ? entry.points.filter((point): point is number => typeof point === "number" && Number.isFinite(point))
          : [];
        return [symbol, { points, trend }] as const;
      })
      .filter((item): item is readonly [string, { points: number[]; trend: "up" | "down" | "flat" }] => item !== null)
  );

  return {
    ok: true,
    items,
  };
}

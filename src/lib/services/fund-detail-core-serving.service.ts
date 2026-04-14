import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { classifyDatabaseError } from "@/lib/database-error-classifier";
import { promises as fs } from "node:fs";
import path from "node:path";

const DAY_MS = 86_400_000;
const CORE_SERVING_KEY_PREFIX = "fund_detail_core:v1";
const CORE_SERVING_VERSION = 1;
const CORE_SERVING_LOOKBACK_DAYS = parseEnvInt("FUND_DETAIL_CORE_SERVING_LOOKBACK_DAYS", 1095, 90, 1460);
const CORE_SERVING_SERIES_MAX_POINTS = parseEnvInt("FUND_DETAIL_CORE_SERVING_SERIES_MAX_POINTS", 90, 20, 180);
const CORE_SERVING_HISTORY_ENABLED = process.env.FUND_DETAIL_HISTORY_SERVING_ENABLED !== "0";
const CORE_SERVING_HISTORY_LOOKBACK_DAYS = parseEnvInt(
  "FUND_DETAIL_HISTORY_SERVING_LOOKBACK_DAYS",
  1095,
  180,
  1460
);
const CORE_SERVING_HISTORY_RECENT_DAYS = parseEnvInt(
  "FUND_DETAIL_HISTORY_SERVING_RECENT_DAYS",
  180,
  30,
  365
);
const CORE_SERVING_HISTORY_FAR_STRIDE_DAYS = parseEnvInt(
  "FUND_DETAIL_HISTORY_SERVING_FAR_STRIDE_DAYS",
  7,
  2,
  30
);
const CORE_SERVING_HISTORY_MAX_POINTS = parseEnvInt(
  "FUND_DETAIL_HISTORY_SERVING_MAX_POINTS",
  360,
  90,
  720
);
const CORE_SERVING_REBUILD_CHUNK_SIZE = parseEnvInt("FUND_DETAIL_CORE_SERVING_REBUILD_CHUNK_SIZE", 60, 20, 500);
const CORE_SERVING_REBUILD_HISTORY_CHUNK_SIZE = parseEnvInt(
  "FUND_DETAIL_CORE_SERVING_REBUILD_HISTORY_CHUNK_SIZE",
  40,
  10,
  500
);
const CORE_SERVING_REBUILD_QUERY_TIMEOUT_MS = parseEnvInt(
  "FUND_DETAIL_CORE_SERVING_REBUILD_QUERY_TIMEOUT_MS",
  120_000,
  5_000,
  600_000
);
const CORE_SERVING_REBUILD_HISTORY_READ_TIMEOUT_MS = parseEnvInt(
  "FUND_DETAIL_CORE_SERVING_REBUILD_HISTORY_READ_TIMEOUT_MS",
  45_000,
  5_000,
  120_000
);
/** Pool checkout bekleme süresi; kısa maxWait rebuild + dev sunucu iken sık P2024 üretiyordu. */
const CORE_SERVING_REBUILD_QUERY_MAX_WAIT_MS = parseEnvInt(
  "FUND_DETAIL_CORE_SERVING_REBUILD_MAX_WAIT_MS",
  45_000,
  500,
  180_000
);
const CORE_SERVING_REBUILD_READ_RETRIES = parseEnvInt("FUND_DETAIL_CORE_SERVING_REBUILD_READ_RETRIES", 5, 1, 12);
const CORE_SERVING_REBUILD_INTER_CHUNK_DELAY_MS = parseEnvInt(
  "FUND_DETAIL_CORE_SERVING_REBUILD_INTER_CHUNK_DELAY_MS",
  0,
  0,
  5_000
);
const CORE_SERVING_REBUILD_DB_WRITE_MAX_WAIT_MS = parseEnvInt(
  "FUND_DETAIL_CORE_SERVING_REBUILD_DB_WRITE_MAX_WAIT_MS",
  60_000,
  5_000,
  180_000
);
const CORE_SERVING_REBUILD_DB_WRITE_TIMEOUT_MS = parseEnvInt(
  "FUND_DETAIL_CORE_SERVING_REBUILD_DB_WRITE_TIMEOUT_MS",
  300_000,
  30_000,
  900_000
);
const CORE_SERVING_REBUILD_FUND_RETRIES = parseEnvInt("FUND_DETAIL_CORE_SERVING_REBUILD_FUND_RETRIES", 4, 0, 8);
const CORE_SERVING_REBUILD_MAX_CANDIDATE_FUNDS = parseEnvInt(
  "FUND_DETAIL_CORE_SERVING_REBUILD_MAX_CANDIDATE_FUNDS",
  0,
  0,
  20_000
);
/** Tam rebuild’de N başarılı kayıtta bir disk+DB flush; kesinti sonrası ilerleme korunur. Partial varsayılan 0. */
const CORE_SERVING_REBUILD_CHECKPOINT_EVERY_FUNDS_FULL = parseEnvInt(
  "FUND_DETAIL_CORE_SERVING_REBUILD_CHECKPOINT_EVERY_FUNDS",
  100,
  0,
  5_000
);
const CORE_SERVING_REBUILD_CHECKPOINT_EVERY_FUNDS_PARTIAL = parseEnvInt(
  "FUND_DETAIL_CORE_SERVING_REBUILD_CHECKPOINT_EVERY_FUNDS_PARTIAL",
  0,
  0,
  5_000
);
const CORE_SERVING_REBUILD_CODES = (() => {
  const raw = process.env.FUND_DETAIL_CORE_SERVING_REBUILD_CODES?.trim();
  if (!raw) return null;
  const set = new Set(
    raw
      .split(/[,\s]+/)
      .map((code) => code.trim().toUpperCase())
      .filter((code) => code.length > 0)
  );
  return set.size > 0 ? set : null;
})();
const CORE_SERVING_REBUILD_HISTORY_FOR_SNAPSHOT_POINTS_BELOW = parseEnvInt(
  "FUND_DETAIL_CORE_SERVING_REBUILD_HISTORY_FOR_SNAPSHOT_POINTS_BELOW",
  180,
  30,
  720
);
const CORE_SERVING_MEMORY_TTL_MS = parseEnvInt("FUND_DETAIL_CORE_SERVING_MEMORY_TTL_MS", 180_000, 1_000, 30 * 60_000);
const CORE_SERVING_FILE_REFRESH_MS = parseEnvInt("FUND_DETAIL_CORE_SERVING_FILE_REFRESH_MS", 15_000, 1_000, 10 * 60_000);
const CORE_SERVING_ON_DEMAND_ENABLED = process.env.FUND_DETAIL_CORE_SERVING_ON_DEMAND !== "0";
const CORE_SERVING_ON_DEMAND_ROWS = parseEnvInt("FUND_DETAIL_CORE_SERVING_ON_DEMAND_ROWS", 120, 20, 360);
const CORE_SERVING_ON_DEMAND_TIMEOUT_MS = parseEnvInt("FUND_DETAIL_CORE_SERVING_ON_DEMAND_TIMEOUT_MS", 1_400, 400, 6_000);
const CORE_SERVING_BOOTSTRAP_ON_MISS = process.env.FUND_DETAIL_CORE_SERVING_BOOTSTRAP_ON_MISS !== "0";
const CORE_SERVING_BOOTSTRAP_COOLDOWN_MS = parseEnvInt(
  "FUND_DETAIL_CORE_SERVING_BOOTSTRAP_COOLDOWN_MS",
  30_000,
  5_000,
  5 * 60_000
);
const CORE_SERVING_FILE_PATH =
  process.env.FUND_DETAIL_CORE_SERVING_FILE_PATH?.trim() ||
  path.join(process.cwd(), ".cache", "fund-detail-core-serving.v1.json");

export type FundDetailCoreSeriesPoint = { t: number; p: number };
export type FundDetailCoreTrendPoint = { t: number; v: number };

/** Rebuild sonrası investor/AUM serisinin nasıl üretildiği (runtime debug / tüketici şeffaflığı). */
export type FundDetailTrendSeriesServingMeta = {
  source: "merged_history_hybrid" | "snapshot_stride";
  mergedInputPoints: number;
  outputPoints: number;
  historyAttempted: boolean;
  historyErrorCategory: string | null;
  fallbackReason: string | null;
};

export type FundDetailHistoryServingPoint = {
  t: number;
  p: number;
  d: number | null;
  i: number | null;
  s: number | null;
};

export type FundDetailCoreServingPayload = {
  version: number;
  generatedAt: string;
  sourceDate: string | null;
  fund: {
    fundId: string;
    code: string;
    name: string;
    shortName: string | null;
    logoUrl: string | null;
    categoryCode: string | null;
    categoryName: string | null;
    fundTypeCode: number | null;
    fundTypeName: string | null;
  };
  latestSnapshotDate: string | null;
  latestPrice: number;
  dailyChangePct: number;
  monthlyReturn: number;
  yearlyReturn: number;
  snapshotAlpha: number | null;
  riskLevel: string | null;
  snapshotMetrics: unknown;
  miniPriceSeries: FundDetailCoreSeriesPoint[];
  chartHistory: {
    mode: string;
    lookbackDays: number;
    minDate: string | null;
    maxDate: string | null;
    points: FundDetailHistoryServingPoint[];
    metadata?: {
      source: "snapshot_only" | "snapshot_plus_history";
      snapshotPoints: number;
      historyPoints: number;
      historyAttempted: boolean;
      historyErrorCategory: string | null;
    };
  } | null;
  investorSummary: {
    current: number;
    delta: number | null;
    min: number | null;
    max: number | null;
    series: FundDetailCoreTrendPoint[];
    seriesMeta?: FundDetailTrendSeriesServingMeta;
  };
  portfolioSummary: {
    current: number;
    delta: number | null;
    min: number | null;
    max: number | null;
    series: FundDetailCoreTrendPoint[];
    seriesMeta?: FundDetailTrendSeriesServingMeta;
  };
};

export type FundDetailCoreServingRebuildResult = {
  written: number;
  /** Bu koşuda üretilen yeni/güncellenen kayıt sayısı (disk merge öncesi). */
  writtenThisRun: number;
  /** Merge sonrası artifact’taki toplam kayıt sayısı; yazım atlandıysa önceki değer veya 0. */
  writtenRecords: number;
  rebuildMode: "full" | "partial";
  /** Aktif fon evreni (CODE/MAX filtreleri öncesi). */
  universeFundsTotal: number;
  partialMerge: boolean;
  /** Atomik dosya yazımı yapıldı mı (0 güncelleme ise false). */
  replacedArtifact: boolean;
  mergedFromExistingRecords: number;
  scannedRows: number;
  snapshotDate: string | null;
  candidateFunds: number;
  processedFunds: number;
  succeededFunds: number;
  failedFunds: number;
  skippedFunds: number;
  retries: number;
  failedChunks: number;
  snapshotReadAttempts: number;
  snapshotReadTimeoutCount: number;
  historyFallbackAttempts: number;
  fullyCompleted: boolean;
  /** Tam/partial modda checkpoint ile kaç kez artifact+DB flush yapıldı (son toplu yazım dahil). */
  checkpointFlushes: number;
  elapsedMs: number;
  timeoutStats: {
    poolCheckoutTimeout: number;
    statementTimeout: number;
    transactionTimeout: number;
    connectionClosed: number;
  };
};

type ChartHistoryBuildInput = {
  mode: string;
  points: FundDetailHistoryServingPoint[];
  minDate: string | null;
  maxDate: string | null;
  metadata?: {
    source: "snapshot_only" | "snapshot_plus_history";
    snapshotPoints: number;
    historyPoints: number;
    historyAttempted: boolean;
    historyErrorCategory: string | null;
  };
};

export type FundDetailCoreServingListRow = {
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  fundTypeCode: number | null;
  fundTypeName: string | null;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  updatedAt: string;
};

export type FundDetailCoreServingListResult = {
  rows: FundDetailCoreServingListRow[];
  source: "memory" | "file" | "none";
  missReason:
    | "file_missing"
    | "file_empty"
    | "file_parse_error"
    | "cache_empty"
    | "db_miss"
    | "ondemand_empty"
    | "ondemand_failed"
    | null;
};

type FundPriceHistoryServingRow = {
  fundId: string;
  date: Date;
  price: number;
  dailyReturn: number;
  portfolioSize: number;
  investorCount: number;
};

type FundDailySnapshotServingRow = {
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
  metrics: Prisma.JsonValue;
};

type FundDetailCoreServingReadResult = {
  payload: FundDetailCoreServingPayload | null;
  source: "memory" | "file" | "db" | "ondemand" | "miss";
  readMs: number;
  ageMs: number | null;
  missReason?: "file_missing" | "file_empty" | "file_parse_error" | "db_miss" | "ondemand_empty" | "ondemand_failed";
};

type FundDetailCoreServingReadOptions = {
  /**
   * Kritik first-paint yolunda DB sorgusuna düşmeden yalnızca memory/file katmanını dene.
   * Özellikle `.cache` dosyası yokken pool baskısını artırmamak için kullanılır.
   */
  preferFileOnly?: boolean;
};

type CoreServingMemoryEntry = {
  payload: FundDetailCoreServingPayload;
  cachedAt: number;
};

type GlobalWithCoreServingMemory = typeof globalThis & {
  __fundDetailCoreServingMemory?: Map<string, CoreServingMemoryEntry>;
  __fundDetailCoreServingFileCache?: {
    checkedAt: number;
    mtimeMs: number;
    records: Map<string, FundDetailCoreServingPayload>;
  };
  __fundDetailCoreServingBootstrapState?: {
    inFlight: Promise<void> | null;
    status: "idle" | "running" | "ok" | "failed";
    lastStartedAt: number;
    lastCompletedAt: number;
    lastReason: string | null;
    lastError: string | null;
  };
};

function parseEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function getCoreServingMemory(): Map<string, CoreServingMemoryEntry> {
  const g = globalThis as GlobalWithCoreServingMemory;
  if (!g.__fundDetailCoreServingMemory) {
    g.__fundDetailCoreServingMemory = new Map<string, CoreServingMemoryEntry>();
  }
  return g.__fundDetailCoreServingMemory;
}

function getCoreServingFileState(): {
  checkedAt: number;
  mtimeMs: number;
  records: Map<string, FundDetailCoreServingPayload>;
} {
  const g = globalThis as GlobalWithCoreServingMemory;
  if (!g.__fundDetailCoreServingFileCache) {
    g.__fundDetailCoreServingFileCache = {
      checkedAt: 0,
      mtimeMs: 0,
      records: new Map<string, FundDetailCoreServingPayload>(),
    };
  }
  return g.__fundDetailCoreServingFileCache;
}

function toServingListRow(payload: FundDetailCoreServingPayload): FundDetailCoreServingListRow {
  return {
    fundId: payload.fund.fundId,
    code: payload.fund.code,
    name: payload.fund.name,
    shortName: payload.fund.shortName,
    logoUrl: payload.fund.logoUrl,
    categoryCode: payload.fund.categoryCode,
    categoryName: payload.fund.categoryName,
    fundTypeCode: payload.fund.fundTypeCode,
    fundTypeName: payload.fund.fundTypeName,
    lastPrice: Number.isFinite(payload.latestPrice) ? payload.latestPrice : 0,
    dailyReturn: Number.isFinite(payload.dailyChangePct) ? payload.dailyChangePct : 0,
    monthlyReturn: Number.isFinite(payload.monthlyReturn) ? payload.monthlyReturn : 0,
    yearlyReturn: Number.isFinite(payload.yearlyReturn) ? payload.yearlyReturn : 0,
    portfolioSize:
      Number.isFinite(payload.portfolioSummary?.current) && payload.portfolioSummary.current > 0
        ? payload.portfolioSummary.current
        : 0,
    investorCount:
      Number.isFinite(payload.investorSummary?.current) && payload.investorSummary.current > 0
        ? Math.round(payload.investorSummary.current)
        : 0,
    updatedAt: payload.generatedAt,
  };
}

function rankServingRows(left: FundDetailCoreServingListRow, right: FundDetailCoreServingListRow): number {
  const portfolioDiff = right.portfolioSize - left.portfolioSize;
  if (portfolioDiff !== 0) return portfolioDiff;
  const investorDiff = right.investorCount - left.investorCount;
  if (investorDiff !== 0) return investorDiff;
  return left.code.localeCompare(right.code, "tr");
}

function getCoreServingBootstrapState() {
  const g = globalThis as GlobalWithCoreServingMemory;
  if (!g.__fundDetailCoreServingBootstrapState) {
    g.__fundDetailCoreServingBootstrapState = {
      inFlight: null,
      status: "idle",
      lastStartedAt: 0,
      lastCompletedAt: 0,
      lastReason: null,
      lastError: null,
    };
  }
  return g.__fundDetailCoreServingBootstrapState;
}

function isRelationMissingError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

function coreServingCacheKey(code: string): string {
  return `${CORE_SERVING_KEY_PREFIX}:${code.trim().toUpperCase()}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${tag}_timeout_${timeoutMs}ms`)), timeoutMs);
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

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function runBoundedRebuildRead<T>(
  task: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { statementTimeoutMs?: number }
): Promise<T> {
  const statementMs = Math.max(1_000, options?.statementTimeoutMs ?? CORE_SERVING_REBUILD_QUERY_TIMEOUT_MS);
  const workBudgetMs = statementMs + 15_000;
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${statementMs}`);
      return task(tx);
    },
    {
      maxWait: CORE_SERVING_REBUILD_QUERY_MAX_WAIT_MS,
      // Prisma interactive tx: timeout tüm bloklamayı kapsar; büyük sonuç aktarımı için ek pay bırak.
      timeout: CORE_SERVING_REBUILD_QUERY_MAX_WAIT_MS + workBudgetMs + 120_000,
    }
  );
}

function rebuildReadRetryable(error: unknown): boolean {
  const c = classifyDatabaseError(error);
  return (
    c.retryable &&
    (c.category === "pool_checkout_timeout" ||
      c.category === "connection_closed" ||
      c.category === "transaction_timeout" ||
      c.category === "query_execution_timeout")
  );
}

async function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runBoundedRebuildReadWithRetry<T>(
  label: string,
  task: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { statementTimeoutMs?: number }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CORE_SERVING_REBUILD_READ_RETRIES; attempt += 1) {
    try {
      return await runBoundedRebuildRead(task, options);
    } catch (error) {
      lastError = error;
      const retry = rebuildReadRetryable(error) && attempt < CORE_SERVING_REBUILD_READ_RETRIES;
      if (!retry) throw error;
      const backoff = Math.min(8_000, 400 * 2 ** (attempt - 1));
      console.warn(
        `[fund-detail-core-serving-rebuild] read_retry label=${label} attempt=${attempt}/${CORE_SERVING_REBUILD_READ_RETRIES} ` +
          `wait_ms=${backoff} message=${error instanceof Error ? error.message : String(error)}`
      );
      await sleepMs(backoff);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function runRebuildReadNoTxWithRetry<T>(
  label: string,
  task: () => Promise<T>,
  timeoutMs = CORE_SERVING_REBUILD_QUERY_TIMEOUT_MS
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= CORE_SERVING_REBUILD_READ_RETRIES; attempt += 1) {
    try {
      return await withTimeout(task(), timeoutMs, `core_serving_${label}`);
    } catch (error) {
      lastError = error;
      const retry = rebuildReadRetryable(error) && attempt < CORE_SERVING_REBUILD_READ_RETRIES;
      if (!retry) throw error;
      const backoff = Math.min(8_000, 400 * 2 ** (attempt - 1));
      console.warn(
        `[fund-detail-core-serving-rebuild] read_retry label=${label} attempt=${attempt}/${CORE_SERVING_REBUILD_READ_RETRIES} ` +
          `wait_ms=${backoff} message=${error instanceof Error ? error.message : String(error)}`
      );
      await sleepMs(backoff);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function downsampleByStride<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points;
  if (maxPoints <= 2) return [points[0]!, points[points.length - 1]!];
  const result: T[] = [points[0]!];
  const middle = maxPoints - 2;
  const lastIndex = points.length - 1;
  for (let index = 1; index <= middle; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (middle + 1));
    const value = points[sourceIndex];
    if (value && value !== result[result.length - 1]) {
      result.push(value);
    }
  }
  if (result[result.length - 1] !== points[lastIndex]) {
    result.push(points[lastIndex]!);
  }
  return result;
}

function asDateIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  const time = value.getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function dedupeByTimestamp<T extends { t: number }>(points: T[]): T[] {
  const map = new Map<number, T>();
  for (const point of points) {
    if (!Number.isFinite(point.t)) continue;
    map.set(point.t, point);
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

function toHistoryServingPoint(row: FundPriceHistoryServingRow): FundDetailHistoryServingPoint | null {
  if (!(Number.isFinite(row.price) && row.price > 0)) return null;
  const ts = row.date.getTime();
  if (!Number.isFinite(ts)) return null;
  return {
    t: ts,
    p: row.price,
    d: Number.isFinite(row.dailyReturn) ? row.dailyReturn : null,
    i: Number.isFinite(row.investorCount) && row.investorCount >= 0 ? Math.round(row.investorCount) : null,
    s: Number.isFinite(row.portfolioSize) && row.portfolioSize > 0 ? row.portfolioSize : null,
  };
}

function buildHybridHistoryServingPoints(
  rowsAsc: FundPriceHistoryServingRow[]
): {
  mode: string;
  points: FundDetailHistoryServingPoint[];
  minDate: string | null;
  maxDate: string | null;
} {
  if (rowsAsc.length === 0) {
    return {
      mode: "none",
      points: [],
      minDate: null,
      maxDate: null,
    };
  }

  const deduped = dedupeByTimestamp(
    rowsAsc
      .map((row) => toHistoryServingPoint(row))
      .filter((point): point is FundDetailHistoryServingPoint => point != null)
  );
  if (deduped.length === 0) {
    return {
      mode: "none",
      points: [],
      minDate: null,
      maxDate: null,
    };
  }

  const latestTs = deduped[deduped.length - 1]!.t;
  const recentCutoffTs = latestTs - CORE_SERVING_HISTORY_RECENT_DAYS * DAY_MS;
  const farStrideMs = CORE_SERVING_HISTORY_FAR_STRIDE_DAYS * DAY_MS;
  const hybrid: FundDetailHistoryServingPoint[] = [];
  let lastFarKeptTs = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < deduped.length; index += 1) {
    const point = deduped[index]!;
    const isBoundary = index === 0 || index === deduped.length - 1;
    const isRecent = point.t >= recentCutoffTs;
    let keep = isBoundary || isRecent;
    if (!keep) {
      if (!Number.isFinite(lastFarKeptTs) || point.t - lastFarKeptTs >= farStrideMs) {
        keep = true;
      }
    }
    if (!keep) continue;
    hybrid.push(point);
    if (!isRecent) {
      lastFarKeptTs = point.t;
    }
  }

  const points =
    hybrid.length > CORE_SERVING_HISTORY_MAX_POINTS
      ? downsampleByStride(hybrid, CORE_SERVING_HISTORY_MAX_POINTS)
      : hybrid;
  const firstPoint = points[0] ?? null;
  const lastPoint = points.length > 0 ? points[points.length - 1]! : null;
  const minDate = firstPoint ? new Date(firstPoint.t).toISOString() : null;
  const maxDate = lastPoint ? new Date(lastPoint.t).toISOString() : null;

  return {
    mode: "hybrid_recent_daily_far_weekly_v1",
    points,
    minDate,
    maxDate,
  };
}

function buildHybridHistoryServingFromPoints(
  inputPoints: FundDetailHistoryServingPoint[]
): {
  mode: string;
  points: FundDetailHistoryServingPoint[];
  minDate: string | null;
  maxDate: string | null;
} {
  if (inputPoints.length === 0) {
    return {
      mode: "none",
      points: [],
      minDate: null,
      maxDate: null,
    };
  }
  const deduped = dedupeByTimestamp(
    inputPoints.filter(
      (point): point is FundDetailHistoryServingPoint =>
        Number.isFinite(point.t) &&
        Number.isFinite(point.p) &&
        point.p > 0
    )
  );
  if (deduped.length === 0) {
    return {
      mode: "none",
      points: [],
      minDate: null,
      maxDate: null,
    };
  }
  const latestTs = deduped[deduped.length - 1]!.t;
  const recentCutoffTs = latestTs - CORE_SERVING_HISTORY_RECENT_DAYS * DAY_MS;
  const farStrideMs = CORE_SERVING_HISTORY_FAR_STRIDE_DAYS * DAY_MS;
  const hybrid: FundDetailHistoryServingPoint[] = [];
  let lastFarKeptTs = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < deduped.length; index += 1) {
    const point = deduped[index]!;
    const isBoundary = index === 0 || index === deduped.length - 1;
    const isRecent = point.t >= recentCutoffTs;
    let keep = isBoundary || isRecent;
    if (!keep) {
      if (!Number.isFinite(lastFarKeptTs) || point.t - lastFarKeptTs >= farStrideMs) {
        keep = true;
      }
    }
    if (!keep) continue;
    hybrid.push(point);
    if (!isRecent) lastFarKeptTs = point.t;
  }
  const points =
    hybrid.length > CORE_SERVING_HISTORY_MAX_POINTS
      ? downsampleByStride(hybrid, CORE_SERVING_HISTORY_MAX_POINTS)
      : hybrid;
  const firstPoint = points[0] ?? null;
  const lastPoint = points.length > 0 ? points[points.length - 1]! : null;
  const minDate = firstPoint ? new Date(firstPoint.t).toISOString() : null;
  const maxDate = lastPoint ? new Date(lastPoint.t).toISOString() : null;
  return {
    mode: "hybrid_recent_daily_far_weekly_v2",
    points,
    minDate,
    maxDate,
  };
}

/** Fiyat grafiğiyle aynı recent/downsampling kuralları; {t,v} trend serisi için. */
function buildHybridTrendValueSeries(valuePoints: FundDetailCoreTrendPoint[]): FundDetailCoreTrendPoint[] {
  if (valuePoints.length === 0) return [];
  const deduped = dedupeByTimestamp(
    valuePoints.filter((point) => Number.isFinite(point.t) && Number.isFinite(point.v))
  );
  if (deduped.length === 0) return [];
  const latestTs = deduped[deduped.length - 1]!.t;
  const recentCutoffTs = latestTs - CORE_SERVING_HISTORY_RECENT_DAYS * DAY_MS;
  const farStrideMs = CORE_SERVING_HISTORY_FAR_STRIDE_DAYS * DAY_MS;
  const hybrid: FundDetailCoreTrendPoint[] = [];
  let lastFarKeptTs = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < deduped.length; index += 1) {
    const point = deduped[index]!;
    const isBoundary = index === 0 || index === deduped.length - 1;
    const isRecent = point.t >= recentCutoffTs;
    let keep = isBoundary || isRecent;
    if (!keep) {
      if (!Number.isFinite(lastFarKeptTs) || point.t - lastFarKeptTs >= farStrideMs) {
        keep = true;
      }
    }
    if (!keep) continue;
    hybrid.push(point);
    if (!isRecent) lastFarKeptTs = point.t;
  }
  if (hybrid.length > CORE_SERVING_HISTORY_MAX_POINTS) {
    return downsampleByStride(hybrid, CORE_SERVING_HISTORY_MAX_POINTS).map((point) => ({
      t: point.t,
      v: point.v,
    }));
  }
  return hybrid;
}

type ServingTrendMergeInput = {
  mergedPoints: FundDetailHistoryServingPoint[];
  historyAttempted: boolean;
  historyErrorCategory: string | null;
};

function buildServingPayloadFromSnapshots(
  rowsAsc: FundDailySnapshotServingRow[],
  chartHistory?: ChartHistoryBuildInput | null,
  trendMerge?: ServingTrendMergeInput | null
): FundDetailCoreServingPayload | null {
  if (rowsAsc.length === 0) return null;
  const latest = rowsAsc[rowsAsc.length - 1]!;

  const priceSeries = dedupeByTimestamp(
    rowsAsc
      .filter((row) => Number.isFinite(row.lastPrice) && row.lastPrice > 0)
      .map((row) => ({ t: row.date.getTime(), p: row.lastPrice }))
  );
  const investorSeries = dedupeByTimestamp(
    rowsAsc
      .filter((row) => Number.isFinite(row.investorCount) && row.investorCount >= 0)
      .map((row) => ({ t: row.date.getTime(), v: Math.max(0, Math.round(row.investorCount)) }))
  );
  const portfolioSeries = dedupeByTimestamp(
    rowsAsc
      .filter((row) => Number.isFinite(row.portfolioSize) && row.portfolioSize > 0)
      .map((row) => ({ t: row.date.getTime(), v: row.portfolioSize }))
  );

  const compactPriceSeries = downsampleByStride(priceSeries, CORE_SERVING_SERIES_MAX_POINTS);
  const compactInvestorSeries = downsampleByStride(investorSeries, CORE_SERVING_SERIES_MAX_POINTS);
  const compactPortfolioSeries = downsampleByStride(portfolioSeries, CORE_SERVING_SERIES_MAX_POINTS);

  const mergedList =
    trendMerge?.mergedPoints != null
      ? dedupeByTimestamp(
          trendMerge.mergedPoints.filter(
            (point): point is FundDetailHistoryServingPoint =>
              Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0
          )
        )
      : [];
  const investorMergedRaw = dedupeByTimestamp(
    mergedList
      .filter((point) => Number.isFinite(Number(point.i)) && Number(point.i) >= 0)
      .map((point) => ({ t: point.t, v: Math.max(0, Math.round(Number(point.i))) }))
  );
  const portfolioMergedRaw = dedupeByTimestamp(
    mergedList
      .filter((point) => Number.isFinite(Number(point.s)) && Number(point.s) > 0)
      .map((point) => ({ t: point.t, v: Number(point.s) }))
  );
  const investorHybridFromMerge =
    mergedList.length > 0 ? buildHybridTrendValueSeries(investorMergedRaw) : [];
  const portfolioHybridFromMerge =
    mergedList.length > 0 ? buildHybridTrendValueSeries(portfolioMergedRaw) : [];

  const historyAttempted = trendMerge?.historyAttempted ?? false;
  const historyErrorCategory = trendMerge?.historyErrorCategory ?? null;

  let finalInvestorSeries = compactInvestorSeries;
  let investorMeta: FundDetailTrendSeriesServingMeta = {
    source: "snapshot_stride",
    mergedInputPoints: investorSeries.length,
    outputPoints: compactInvestorSeries.length,
    historyAttempted,
    historyErrorCategory,
    fallbackReason: null,
  };
  if (investorHybridFromMerge.length >= 2) {
    finalInvestorSeries = investorHybridFromMerge;
    investorMeta = {
      source: "merged_history_hybrid",
      mergedInputPoints: investorMergedRaw.length,
      outputPoints: investorHybridFromMerge.length,
      historyAttempted,
      historyErrorCategory,
      fallbackReason: null,
    };
  } else if (mergedList.length > 0) {
    investorMeta = {
      source: "snapshot_stride",
      mergedInputPoints: investorMergedRaw.length,
      outputPoints: compactInvestorSeries.length,
      historyAttempted,
      historyErrorCategory,
      fallbackReason:
        investorMergedRaw.length < 2
          ? "insufficient_distinct_investor_points_in_merge"
          : "hybrid_investor_output_lt_2",
    };
  }

  let finalPortfolioSeries = compactPortfolioSeries;
  let portfolioMeta: FundDetailTrendSeriesServingMeta = {
    source: "snapshot_stride",
    mergedInputPoints: portfolioSeries.length,
    outputPoints: compactPortfolioSeries.length,
    historyAttempted,
    historyErrorCategory,
    fallbackReason: null,
  };
  if (portfolioHybridFromMerge.length >= 2) {
    finalPortfolioSeries = portfolioHybridFromMerge;
    portfolioMeta = {
      source: "merged_history_hybrid",
      mergedInputPoints: portfolioMergedRaw.length,
      outputPoints: portfolioHybridFromMerge.length,
      historyAttempted,
      historyErrorCategory,
      fallbackReason: null,
    };
  } else if (mergedList.length > 0) {
    portfolioMeta = {
      source: "snapshot_stride",
      mergedInputPoints: portfolioMergedRaw.length,
      outputPoints: compactPortfolioSeries.length,
      historyAttempted,
      historyErrorCategory,
      fallbackReason:
        portfolioMergedRaw.length < 2
          ? "insufficient_distinct_aum_points_in_merge"
          : "hybrid_aum_output_lt_2",
    };
  }

  const investorValues = finalInvestorSeries.map((point) => point.v);
  const portfolioValues = finalPortfolioSeries.map((point) => point.v);
  const latestInvestor = Number.isFinite(latest.investorCount)
    ? Math.max(0, Math.round(latest.investorCount))
    : finalInvestorSeries[finalInvestorSeries.length - 1]?.v;
  const latestPortfolio = Number.isFinite(latest.portfolioSize) && latest.portfolioSize > 0
    ? latest.portfolioSize
    : finalPortfolioSeries[finalPortfolioSeries.length - 1]?.v;

  const generatedAt = new Date().toISOString();
  const sourceDate = asDateIso(latest.date);
  const chartHistoryPoints = chartHistory?.points ?? [];
  const normalizedChartHistory = {
    mode: chartHistory?.mode ?? "snapshot_compact",
    lookbackDays: CORE_SERVING_HISTORY_LOOKBACK_DAYS,
    minDate: chartHistory?.minDate ?? (compactPriceSeries[0] ? new Date(compactPriceSeries[0].t).toISOString() : null),
    maxDate:
      chartHistory?.maxDate ??
      (compactPriceSeries[compactPriceSeries.length - 1]
        ? new Date(compactPriceSeries[compactPriceSeries.length - 1]!.t).toISOString()
        : null),
    points:
      chartHistoryPoints.length > 0
        ? chartHistoryPoints
        : compactPriceSeries.map((point) => ({ t: point.t, p: point.p, d: null, i: null, s: null })),
    metadata: chartHistory?.metadata,
  };

  return {
    version: CORE_SERVING_VERSION,
    generatedAt,
    sourceDate,
    fund: {
      fundId: latest.fundId,
      code: latest.code,
      name: latest.name,
      shortName: latest.shortName,
      logoUrl: latest.logoUrl,
      categoryCode: latest.categoryCode,
      categoryName: latest.categoryName,
      fundTypeCode: latest.fundTypeCode,
      fundTypeName: latest.fundTypeName,
    },
    latestSnapshotDate: sourceDate,
    latestPrice: asFiniteNumber(latest.lastPrice, 0),
    dailyChangePct: asFiniteNumber(latest.dailyReturn, 0),
    monthlyReturn: asFiniteNumber(latest.monthlyReturn, 0),
    yearlyReturn: asFiniteNumber(latest.yearlyReturn, 0),
    snapshotAlpha: Number.isFinite(latest.alpha) ? latest.alpha : null,
    riskLevel: latest.riskLevel,
    snapshotMetrics: latest.metrics,
    miniPriceSeries: compactPriceSeries,
    chartHistory: normalizedChartHistory,
    investorSummary: {
      current: Number.isFinite(latestInvestor as number)
        ? Math.max(0, Math.round(latestInvestor as number))
        : Math.max(0, Math.round(latest.investorCount)),
      delta:
        investorValues.length >= 2
          ? Math.round(investorValues[investorValues.length - 1]! - investorValues[0]!)
          : null,
      min: investorValues.length > 0 ? Math.round(Math.min(...investorValues)) : null,
      max: investorValues.length > 0 ? Math.round(Math.max(...investorValues)) : null,
      series: finalInvestorSeries,
      seriesMeta: investorMeta,
    },
    portfolioSummary: {
      current: Number.isFinite(latestPortfolio as number)
        ? Number(latestPortfolio)
        : Math.max(0, latest.portfolioSize),
      delta:
        portfolioValues.length >= 2
          ? Number((portfolioValues[portfolioValues.length - 1]! - portfolioValues[0]!).toFixed(2))
          : null,
      min: portfolioValues.length > 0 ? Number(Math.min(...portfolioValues).toFixed(2)) : null,
      max: portfolioValues.length > 0 ? Number(Math.max(...portfolioValues).toFixed(2)) : null,
      series: finalPortfolioSeries,
      seriesMeta: portfolioMeta,
    },
  };
}

function normalizeTrendSeriesMeta(raw: unknown): FundDetailTrendSeriesServingMeta | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (o.source !== "merged_history_hybrid" && o.source !== "snapshot_stride") return undefined;
  return {
    source: o.source,
    mergedInputPoints: Number.isFinite(Number(o.mergedInputPoints))
      ? Math.max(0, Math.trunc(Number(o.mergedInputPoints)))
      : 0,
    outputPoints: Number.isFinite(Number(o.outputPoints)) ? Math.max(0, Math.trunc(Number(o.outputPoints))) : 0,
    historyAttempted: o.historyAttempted === true,
    historyErrorCategory: typeof o.historyErrorCategory === "string" ? o.historyErrorCategory : null,
    fallbackReason: typeof o.fallbackReason === "string" ? o.fallbackReason : null,
  };
}

function parseServingPayload(raw: unknown): FundDetailCoreServingPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const payload = raw as FundDetailCoreServingPayload;
  if (payload.version !== CORE_SERVING_VERSION) return null;
  if (!payload.fund || typeof payload.fund.code !== "string") return null;
  if (!Array.isArray(payload.miniPriceSeries)) return null;
  if (!payload.investorSummary || !Array.isArray(payload.investorSummary.series)) return null;
  if (!payload.portfolioSummary || !Array.isArray(payload.portfolioSummary.series)) return null;
  if (payload.chartHistory && (!payload.chartHistory.points || !Array.isArray(payload.chartHistory.points))) {
    return null;
  }

  const normalizedChartHistoryPoints = payload.chartHistory?.points
    ?.map((point) => {
      const t = Number(point?.t);
      const p = Number(point?.p);
      if (!Number.isFinite(t) || !Number.isFinite(p) || p <= 0) return null;
      const d = point?.d;
      const i = point?.i;
      const s = point?.s;
      return {
        t,
        p,
        d: Number.isFinite(Number(d)) ? Number(d) : null,
        i: Number.isFinite(Number(i)) ? Math.max(0, Math.round(Number(i))) : null,
        s: Number.isFinite(Number(s)) && Number(s) > 0 ? Number(s) : null,
      } satisfies FundDetailHistoryServingPoint;
    })
    .filter((point): point is FundDetailHistoryServingPoint => point != null);
  payload.chartHistory = {
    mode: payload.chartHistory?.mode || "snapshot_compact",
    lookbackDays:
      typeof payload.chartHistory?.lookbackDays === "number" && Number.isFinite(payload.chartHistory.lookbackDays)
        ? payload.chartHistory.lookbackDays
        : CORE_SERVING_HISTORY_LOOKBACK_DAYS,
    minDate: payload.chartHistory?.minDate ?? null,
    maxDate: payload.chartHistory?.maxDate ?? null,
    points:
      normalizedChartHistoryPoints && normalizedChartHistoryPoints.length > 0
        ? dedupeByTimestamp(normalizedChartHistoryPoints)
        : dedupeByTimestamp(
            payload.miniPriceSeries
              .filter((point) => Number.isFinite(point?.t) && Number.isFinite(point?.p) && point.p > 0)
              .map((point) => ({ t: point.t, p: point.p, d: null, i: null, s: null }))
          ),
    metadata:
      payload.chartHistory?.metadata &&
      typeof payload.chartHistory.metadata === "object" &&
      !Array.isArray(payload.chartHistory.metadata)
        ? {
            source:
              payload.chartHistory.metadata.source === "snapshot_plus_history"
                ? "snapshot_plus_history"
                : "snapshot_only",
            snapshotPoints: Number.isFinite(Number(payload.chartHistory.metadata.snapshotPoints))
              ? Math.max(0, Math.trunc(Number(payload.chartHistory.metadata.snapshotPoints)))
              : 0,
            historyPoints: Number.isFinite(Number(payload.chartHistory.metadata.historyPoints))
              ? Math.max(0, Math.trunc(Number(payload.chartHistory.metadata.historyPoints)))
              : 0,
            historyAttempted: payload.chartHistory.metadata.historyAttempted === true,
            historyErrorCategory:
              typeof payload.chartHistory.metadata.historyErrorCategory === "string"
                ? payload.chartHistory.metadata.historyErrorCategory
                : null,
          }
        : undefined,
  };
  const invMeta = normalizeTrendSeriesMeta(
    (payload.investorSummary as { seriesMeta?: unknown }).seriesMeta
  );
  if (invMeta) payload.investorSummary.seriesMeta = invMeta;
  else delete (payload.investorSummary as { seriesMeta?: unknown }).seriesMeta;
  const portMeta = normalizeTrendSeriesMeta(
    (payload.portfolioSummary as { seriesMeta?: unknown }).seriesMeta
  );
  if (portMeta) payload.portfolioSummary.seriesMeta = portMeta;
  else delete (payload.portfolioSummary as { seriesMeta?: unknown }).seriesMeta;
  return payload;
}

async function loadServingRecordsMapFromDisk(): Promise<{
  map: Map<string, FundDetailCoreServingPayload>;
  existingFileUnreadable: boolean;
}> {
  try {
    const raw = await fs.readFile(CORE_SERVING_FILE_PATH, "utf8");
    let parsed: { version?: number; records?: Record<string, unknown> };
    try {
      parsed = JSON.parse(raw) as { version?: number; records?: Record<string, unknown> };
    } catch {
      return { map: new Map(), existingFileUnreadable: true };
    }
    const next = new Map<string, FundDetailCoreServingPayload>();
    if (parsed?.version === CORE_SERVING_VERSION && parsed.records && typeof parsed.records === "object") {
      for (const [recordCode, candidate] of Object.entries(parsed.records)) {
        const payload = parseServingPayload(candidate);
        if (!payload) continue;
        next.set(recordCode.trim().toUpperCase(), payload);
      }
    }
    return { map: next, existingFileUnreadable: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { map: new Map(), existingFileUnreadable: false };
    }
    return { map: new Map(), existingFileUnreadable: true };
  }
}

/**
 * Mevcut artifact ile birleştirerek yazar; partial koşuda evren daralmaz.
 * Okunamayan mevcut dosyada (bozuk JSON) üzerine yazmayı reddeder.
 */
async function writeServingArtifactMergeAtomic(options: {
  snapshotDateIso: string | null;
  updates: Array<{ code: string; payload: FundDetailCoreServingPayload }>;
}): Promise<{
  totalRecords: number;
  mergedFromExisting: number;
  appliedUpdates: number;
}> {
  const { map: merged, existingFileUnreadable } = await loadServingRecordsMapFromDisk();
  if (existingFileUnreadable) {
    throw new Error(
      `[fund-detail-core-serving] mevcut artifact okunamadı veya bozuk: ${CORE_SERVING_FILE_PATH} — güvenlik için yazım iptal`
    );
  }
  const mergedFromExisting = merged.size;
  for (const u of options.updates) {
    merged.set(u.code.trim().toUpperCase(), u.payload);
  }
  const byCode: Record<string, FundDetailCoreServingPayload> = {};
  for (const [k, v] of merged) {
    byCode[k] = v;
  }
  const body = JSON.stringify({
    version: CORE_SERVING_VERSION,
    generatedAt: new Date().toISOString(),
    snapshotDate: options.snapshotDateIso,
    records: byCode,
  });
  const directory = path.dirname(CORE_SERVING_FILE_PATH);
  await fs.mkdir(directory, { recursive: true });
  const tempPath = `${CORE_SERVING_FILE_PATH}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tempPath, body, "utf8");
  await fs.rename(tempPath, CORE_SERVING_FILE_PATH);

  const state = getCoreServingFileState();
  state.records = merged;
  try {
    const st = await fs.stat(CORE_SERVING_FILE_PATH);
    state.mtimeMs = st.mtimeMs;
  } catch {
    state.mtimeMs = Date.now();
  }
  state.checkedAt = Date.now();

  console.info(
    `[fund-detail-core-serving-artifact] snapshotDate=${options.snapshotDateIso} totalRecords=${merged.size} ` +
      `appliedUpdates=${options.updates.length} mergedFromExisting=${mergedFromExisting}`
  );

  return { totalRecords: merged.size, mergedFromExisting, appliedUpdates: options.updates.length };
}

async function getFundDetailCoreServingFromFile(
  code: string
): Promise<{ payload: FundDetailCoreServingPayload | null; missReason: "file_missing" | "file_empty" | "file_parse_error" | null }> {
  const state = getCoreServingFileState();
  const now = Date.now();
  if (now - state.checkedAt <= CORE_SERVING_FILE_REFRESH_MS) {
    const cached = state.records.get(code) ?? null;
    if (cached) return { payload: cached, missReason: null };
    return { payload: null, missReason: state.records.size > 0 ? "file_empty" : "file_missing" };
  }

  try {
    const stats = await fs.stat(CORE_SERVING_FILE_PATH);
    if (state.mtimeMs === stats.mtimeMs && state.records.size > 0) {
      state.checkedAt = now;
      const cached = state.records.get(code) ?? null;
      if (cached) return { payload: cached, missReason: null };
      return { payload: null, missReason: "file_empty" };
    }

    const raw = await fs.readFile(CORE_SERVING_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      version?: number;
      records?: Record<string, unknown>;
    };
    const next = new Map<string, FundDetailCoreServingPayload>();
    if (parsed?.version === CORE_SERVING_VERSION && parsed.records && typeof parsed.records === "object") {
      for (const [recordCode, candidate] of Object.entries(parsed.records)) {
        const payload = parseServingPayload(candidate);
        if (!payload) continue;
        next.set(recordCode.trim().toUpperCase(), payload);
      }
    }
    state.records = next;
    state.mtimeMs = stats.mtimeMs;
    state.checkedAt = now;
    const payload = state.records.get(code) ?? null;
    if (payload) return { payload, missReason: null };
    return { payload: null, missReason: "file_empty" };
  } catch (error) {
    state.checkedAt = now;
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { payload: null, missReason: "file_missing" };
    }
    return { payload: null, missReason: "file_parse_error" };
  }
}

async function readSnapshotDateHintFromServingFile(): Promise<Date | null> {
  try {
    const raw = await fs.readFile(CORE_SERVING_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as { snapshotDate?: unknown };
    if (typeof parsed.snapshotDate !== "string" || parsed.snapshotDate.trim() === "") return null;
    const date = new Date(parsed.snapshotDate);
    if (!Number.isFinite(date.getTime())) return null;
    return date;
  } catch {
    return null;
  }
}

export async function getFundDetailCoreServingSnapshotDateHint(): Promise<Date | null> {
  return readSnapshotDateHintFromServingFile();
}

export async function listFundDetailCoreServingRows(limit: number): Promise<FundDetailCoreServingListResult> {
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit || 0), 500));
  const now = Date.now();
  const memoryRows = [...getCoreServingMemory().values()]
    .filter((entry) => now - entry.cachedAt <= CORE_SERVING_MEMORY_TTL_MS)
    .map((entry) => toServingListRow(entry.payload))
    .filter((row) => row.code.trim().length > 0);

  if (memoryRows.length >= boundedLimit) {
    memoryRows.sort(rankServingRows);
    return { rows: memoryRows.slice(0, boundedLimit), source: "memory", missReason: null };
  }

  const fileProbe = await getFundDetailCoreServingFromFile("__LIST__");
  const fileState = getCoreServingFileState();
  const fileRows = [...fileState.records.values()]
    .map(toServingListRow)
    .filter((row) => row.code.trim().length > 0);
  if (fileRows.length > 0) {
    fileRows.sort(rankServingRows);
    return { rows: fileRows.slice(0, boundedLimit), source: "file", missReason: null };
  }

  const missReason = fileProbe.missReason ?? (memoryRows.length > 0 ? null : "cache_empty");
  return { rows: [], source: "none", missReason };
}

export async function getFundDetailCoreServingUniversePayloads(): Promise<{
  records: FundDetailCoreServingPayload[];
  source: "memory" | "file" | "none";
  missReason: FundDetailCoreServingListResult["missReason"];
}> {
  const now = Date.now();
  const memoryRecords = [...getCoreServingMemory().values()]
    .filter((entry) => now - entry.cachedAt <= CORE_SERVING_MEMORY_TTL_MS)
    .map((entry) => entry.payload);
  if (memoryRecords.length > 0) {
    return { records: memoryRecords, source: "memory", missReason: null };
  }
  const fileProbe = await getFundDetailCoreServingFromFile("__UNIVERSE__");
  const fileRecords = [...getCoreServingFileState().records.values()];
  if (fileRecords.length > 0) {
    return { records: fileRecords, source: "file", missReason: null };
  }
  return {
    records: [],
    source: "none",
    missReason: fileProbe.missReason ?? "cache_empty",
  };
}

export async function listFundDetailCoreServingAlternatives(
  code: string,
  limit: number
): Promise<FundDetailCoreServingListResult> {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) {
    return { rows: [], source: "none", missReason: "cache_empty" };
  }
  const current = await getFundDetailCoreServingCached(normalizedCode, { preferFileOnly: true });
  if (!current.payload || !current.payload.fund.categoryCode) {
    return {
      rows: [],
      source: current.source === "memory" || current.source === "file" ? current.source : "none",
      missReason: current.missReason ?? "cache_empty",
    };
  }

  const categoryCode = current.payload.fund.categoryCode;
  const now = Date.now();
  const memoryRows = [...getCoreServingMemory().values()]
    .filter((entry) => now - entry.cachedAt <= CORE_SERVING_MEMORY_TTL_MS)
    .map((entry) => toServingListRow(entry.payload));
  const fileProbe = await getFundDetailCoreServingFromFile("__ALT__");
  const fileRows = [...getCoreServingFileState().records.values()].map(toServingListRow);
  const source: "memory" | "file" | "none" = fileRows.length > 0 ? "file" : memoryRows.length > 0 ? "memory" : "none";
  const pool = fileRows.length > 0 ? fileRows : memoryRows;
  if (pool.length === 0) {
    return { rows: [], source, missReason: fileProbe.missReason ?? "cache_empty" };
  }

  const alternatives = pool
    .filter((row) => row.code !== normalizedCode && row.categoryCode === categoryCode)
    .sort(rankServingRows)
    .slice(0, Math.max(1, Math.min(limit, 40)));
  return {
    rows: alternatives,
    source,
    missReason: alternatives.length > 0 ? null : fileProbe.missReason ?? "cache_empty",
  };
}

async function startCoreServingBootstrap(reason: string): Promise<void> {
  if (!CORE_SERVING_BOOTSTRAP_ON_MISS) return;
  const state = getCoreServingBootstrapState();
  const now = Date.now();
  if (state.inFlight) return;
  if (state.lastStartedAt > 0 && now - state.lastStartedAt < CORE_SERVING_BOOTSTRAP_COOLDOWN_MS) return;

  state.status = "running";
  state.lastStartedAt = now;
  state.lastReason = reason;
  state.lastError = null;
  const task = (async () => {
    try {
      const result = await rebuildFundDetailCoreServingCache();
      state.status = "ok";
      state.lastCompletedAt = Date.now();
      state.lastError = null;
      // Sonraki okumalarda dosyayı yeniden taramayı zorla.
      const fileState = getCoreServingFileState();
      fileState.checkedAt = 0;
      console.info(
        `[fund-detail-core-serving-bootstrap] status=ok reason=${reason} written=${result.written} ` +
          `checkpoints=${result.checkpointFlushes} scanned=${result.scannedRows} snapshotDate=${result.snapshotDate ?? "none"}`
      );
    } catch (error) {
      state.status = "failed";
      state.lastCompletedAt = Date.now();
      state.lastError = error instanceof Error ? error.message : String(error);
      console.error(
        `[fund-detail-core-serving-bootstrap] status=failed reason=${reason} error=${state.lastError}`
      );
    } finally {
      state.inFlight = null;
    }
  })();

  state.inFlight = task;
  void task;
}

async function buildFundDetailCoreServingPayloadOnDemand(code: string): Promise<FundDetailCoreServingPayload | null> {
  const rowsDesc = await prisma.fundDailySnapshot.findMany({
    where: { code },
    orderBy: { date: "desc" },
    take: CORE_SERVING_ON_DEMAND_ROWS,
    select: {
      date: true,
      fundId: true,
      code: true,
      name: true,
      shortName: true,
      logoUrl: true,
      categoryCode: true,
      categoryName: true,
      fundTypeCode: true,
      fundTypeName: true,
      riskLevel: true,
      lastPrice: true,
      dailyReturn: true,
      monthlyReturn: true,
      yearlyReturn: true,
      portfolioSize: true,
      investorCount: true,
      alpha: true,
      metrics: true,
    },
  });
  if (rowsDesc.length === 0) return null;
  return buildServingPayloadFromSnapshots([...rowsDesc].reverse());
}

type RebuildFailureStats = {
  retries: number;
  failedChunks: number;
  snapshotReadAttempts: number;
  snapshotReadTimeoutCount: number;
  historyFallbackAttempts: number;
  poolCheckoutTimeout: number;
  statementTimeout: number;
  transactionTimeout: number;
  connectionClosed: number;
};

function bumpFailureCategory(stats: RebuildFailureStats, category: string | null | undefined): void {
  if (category === "pool_checkout_timeout") stats.poolCheckoutTimeout += 1;
  else if (category === "query_execution_timeout") stats.statementTimeout += 1;
  else if (category === "transaction_timeout") stats.transactionTimeout += 1;
  else if (category === "connection_closed") stats.connectionClosed += 1;
}

async function readFundSnapshotRowsForRebuild(input: {
  fundId: string;
  snapshotDate: Date;
  fromDate: Date;
}): Promise<FundDailySnapshotServingRow[]> {
  return runRebuildReadNoTxWithRetry(`snapshot_history_fund_${input.fundId}`, () =>
    prisma.fundDailySnapshot.findMany({
      where: {
        fundId: input.fundId,
        date: {
          gte: input.fromDate,
          lte: input.snapshotDate,
        },
      },
      select: {
        date: true,
        fundId: true,
        code: true,
        name: true,
        shortName: true,
        logoUrl: true,
        categoryCode: true,
        categoryName: true,
        fundTypeCode: true,
        fundTypeName: true,
        riskLevel: true,
        lastPrice: true,
        dailyReturn: true,
        monthlyReturn: true,
        yearlyReturn: true,
        portfolioSize: true,
        investorCount: true,
        alpha: true,
        metrics: true,
      },
      orderBy: { date: "asc" },
    })
  );
}

async function readFundPriceHistoryForRebuild(input: {
  fundId: string;
  snapshotDate: Date;
}): Promise<{
  rows: FundPriceHistoryServingRow[];
  attempted: boolean;
  errorCategory: string | null;
}> {
  const historyFromDate = new Date(input.snapshotDate.getTime() - CORE_SERVING_HISTORY_LOOKBACK_DAYS * DAY_MS);
  try {
    const rows = await runRebuildReadNoTxWithRetry(
      `price_history_fund_${input.fundId}`,
      () =>
        prisma.fundPriceHistory.findMany({
          where: {
            fundId: input.fundId,
            date: {
              gte: historyFromDate,
              lte: input.snapshotDate,
            },
          },
          orderBy: { date: "asc" },
          select: {
            fundId: true,
            date: true,
            price: true,
            dailyReturn: true,
            portfolioSize: true,
            investorCount: true,
          },
        }),
      CORE_SERVING_REBUILD_HISTORY_READ_TIMEOUT_MS
    );
    return {
      attempted: true,
      errorCategory: null,
      rows: rows.map((row) => ({
        fundId: row.fundId,
        date: row.date,
        price: row.price,
        dailyReturn: row.dailyReturn,
        portfolioSize: row.portfolioSize,
        investorCount: row.investorCount,
      })),
    };
  } catch (error) {
    const classified = classifyDatabaseError(error);
    return {
      attempted: true,
      errorCategory: classified.category,
      rows: [],
    };
  }
}

export async function rebuildFundDetailCoreServingCache(options?: {
  sourceDate?: Date;
}): Promise<FundDetailCoreServingRebuildResult> {
  const startedAt = Date.now();
  const failureStats: RebuildFailureStats = {
    retries: 0,
    failedChunks: 0,
    snapshotReadAttempts: 0,
    snapshotReadTimeoutCount: 0,
    historyFallbackAttempts: 0,
    poolCheckoutTimeout: 0,
    statementTimeout: 0,
    transactionTimeout: 0,
    connectionClosed: 0,
  };
  let snapshotDate = options?.sourceDate ?? null;
  if (!snapshotDate) {
    try {
      const latest = await runRebuildReadNoTxWithRetry("snapshot_latest_date", () =>
        prisma.fundDailySnapshot.findFirst({ orderBy: { date: "desc" }, select: { date: true } })
      );
      snapshotDate = latest?.date ?? null;
    } catch (error) {
      const fallbackSnapshotDate = await readSnapshotDateHintFromServingFile();
      if (fallbackSnapshotDate) {
        snapshotDate = fallbackSnapshotDate;
      } else {
        const classified = classifyDatabaseError(error);
        bumpFailureCategory(failureStats, classified.category);
        return {
          written: 0,
          writtenThisRun: 0,
          writtenRecords: 0,
          rebuildMode: "full",
          universeFundsTotal: 0,
          partialMerge: false,
          replacedArtifact: false,
          mergedFromExistingRecords: 0,
          scannedRows: 0,
          snapshotDate: null,
          candidateFunds: 0,
          processedFunds: 0,
          succeededFunds: 0,
          failedFunds: 0,
          skippedFunds: 0,
          retries: failureStats.retries,
          failedChunks: 1,
          snapshotReadAttempts: failureStats.snapshotReadAttempts,
          snapshotReadTimeoutCount: failureStats.snapshotReadTimeoutCount,
          historyFallbackAttempts: failureStats.historyFallbackAttempts,
          fullyCompleted: false,
          checkpointFlushes: 0,
          elapsedMs: Date.now() - startedAt,
          timeoutStats: {
            poolCheckoutTimeout: failureStats.poolCheckoutTimeout,
            statementTimeout: failureStats.statementTimeout,
            transactionTimeout: failureStats.transactionTimeout,
            connectionClosed: failureStats.connectionClosed,
          },
        };
      }
    }
  }

  if (!snapshotDate) {
    return {
      written: 0,
      writtenThisRun: 0,
      writtenRecords: 0,
      rebuildMode: "full",
      universeFundsTotal: 0,
      partialMerge: false,
      replacedArtifact: false,
      mergedFromExistingRecords: 0,
      scannedRows: 0,
      snapshotDate: null,
      candidateFunds: 0,
      processedFunds: 0,
      succeededFunds: 0,
      failedFunds: 0,
      skippedFunds: 0,
      retries: 0,
      failedChunks: 0,
      snapshotReadAttempts: 0,
      snapshotReadTimeoutCount: 0,
      historyFallbackAttempts: 0,
      fullyCompleted: true,
      checkpointFlushes: 0,
      elapsedMs: Date.now() - startedAt,
      timeoutStats: {
        poolCheckoutTimeout: 0,
        statementTimeout: 0,
        transactionTimeout: 0,
        connectionClosed: 0,
      },
    };
  }

  const fromDate = new Date(snapshotDate.getTime() - CORE_SERVING_LOOKBACK_DAYS * DAY_MS);
  let candidateFunds: Array<{ fundId: string; code: string }> = [];
  try {
    let afterCode = "";
    const pageSize = 250;
    while (true) {
      const page = await runRebuildReadNoTxWithRetry("candidate_funds_page", () =>
        prisma.fund.findMany({
          where: {
            isActive: true,
            code: afterCode ? { gt: afterCode } : undefined,
          },
          orderBy: { code: "asc" },
          take: pageSize,
          select: {
            id: true,
            code: true,
          },
        })
      );
      if (page.length === 0) break;
      for (const row of page) {
        candidateFunds.push({ fundId: row.id, code: row.code });
      }
      afterCode = page[page.length - 1]!.code;
      if (page.length < pageSize) break;
    }
  } catch (error) {
    const classified = classifyDatabaseError(error);
    bumpFailureCategory(failureStats, classified.category);
    return {
      written: 0,
      writtenThisRun: 0,
      writtenRecords: 0,
      rebuildMode: "full",
      universeFundsTotal: 0,
      partialMerge: false,
      replacedArtifact: false,
      mergedFromExistingRecords: 0,
      scannedRows: 0,
      snapshotDate: snapshotDate.toISOString(),
      candidateFunds: 0,
      processedFunds: 0,
      succeededFunds: 0,
      failedFunds: 0,
      skippedFunds: 0,
      retries: failureStats.retries,
      failedChunks: 1,
      snapshotReadAttempts: failureStats.snapshotReadAttempts,
      snapshotReadTimeoutCount: failureStats.snapshotReadTimeoutCount,
      historyFallbackAttempts: failureStats.historyFallbackAttempts,
      fullyCompleted: false,
      checkpointFlushes: 0,
      elapsedMs: Date.now() - startedAt,
      timeoutStats: {
        poolCheckoutTimeout: failureStats.poolCheckoutTimeout,
        statementTimeout: failureStats.statementTimeout,
        transactionTimeout: failureStats.transactionTimeout,
        connectionClosed: failureStats.connectionClosed,
      },
    };
  }
  const universeFundsTotal = candidateFunds.length;
  if (CORE_SERVING_REBUILD_CODES && CORE_SERVING_REBUILD_CODES.size > 0) {
    candidateFunds = candidateFunds.filter((row) => CORE_SERVING_REBUILD_CODES.has(row.code.trim().toUpperCase()));
  }
  if (CORE_SERVING_REBUILD_MAX_CANDIDATE_FUNDS > 0 && candidateFunds.length > CORE_SERVING_REBUILD_MAX_CANDIDATE_FUNDS) {
    candidateFunds = candidateFunds.slice(0, CORE_SERVING_REBUILD_MAX_CANDIDATE_FUNDS);
  }
  if (candidateFunds.length === 0) {
    return {
      written: 0,
      writtenThisRun: 0,
      writtenRecords: 0,
      rebuildMode: "full",
      universeFundsTotal,
      partialMerge: false,
      replacedArtifact: false,
      mergedFromExistingRecords: 0,
      scannedRows: 0,
      snapshotDate: snapshotDate.toISOString(),
      candidateFunds: 0,
      processedFunds: 0,
      succeededFunds: 0,
      failedFunds: 0,
      skippedFunds: 0,
      retries: 0,
      failedChunks: 0,
      snapshotReadAttempts: 0,
      snapshotReadTimeoutCount: 0,
      historyFallbackAttempts: 0,
      fullyCompleted: true,
      checkpointFlushes: 0,
      elapsedMs: Date.now() - startedAt,
      timeoutStats: {
        poolCheckoutTimeout: 0,
        statementTimeout: 0,
        transactionTimeout: 0,
        connectionClosed: 0,
      },
    };
  }

  const rebuildMode: "full" | "partial" =
    (!CORE_SERVING_REBUILD_CODES || CORE_SERVING_REBUILD_CODES.size === 0) &&
    CORE_SERVING_REBUILD_MAX_CANDIDATE_FUNDS === 0
      ? "full"
      : "partial";

  const checkpointEvery =
    rebuildMode === "full"
      ? CORE_SERVING_REBUILD_CHECKPOINT_EVERY_FUNDS_FULL
      : CORE_SERVING_REBUILD_CHECKPOINT_EVERY_FUNDS_PARTIAL;
  const snapshotDateIso = snapshotDate.toISOString();

  let scannedRows = 0;
  const servingRows: Array<{ code: string; cacheKey: string; payload: FundDetailCoreServingPayload }> = [];
  let processedFunds = 0;
  let succeededFunds = 0;
  let failedFunds = 0;
  let skippedFunds = 0;
  let checkpointFlushes = 0;
  let totalArtifactCommitted = 0;
  let lastTotalRecords = 0;
  let firstMergedFromExisting: number | null = null;
  let replacedArtifact = false;

  async function flushServingRowsBatch(
    batch: Array<{ code: string; cacheKey: string; payload: FundDetailCoreServingPayload }>
  ): Promise<boolean> {
    if (batch.length === 0) return true;
    try {
      const art = await writeServingArtifactMergeAtomic({
        snapshotDateIso,
        updates: batch.map((row) => ({ code: row.code, payload: row.payload })),
      });
      checkpointFlushes += 1;
      lastTotalRecords = art.totalRecords;
      if (firstMergedFromExisting === null) {
        firstMergedFromExisting = art.mergedFromExisting;
      }
      replacedArtifact = true;
      totalArtifactCommitted += batch.length;
      try {
        const keys = batch.map((row) => row.cacheKey);
        await withTimeout(
          prisma.scoresApiCache.deleteMany({ where: { cacheKey: { in: keys } } }),
          CORE_SERVING_REBUILD_DB_WRITE_TIMEOUT_MS,
          "core_serving_cache_delete_keys"
        );
        for (const group of chunk(batch, 500)) {
          await withTimeout(
            prisma.scoresApiCache.createMany({
              data: group.map((row) => ({
                cacheKey: row.cacheKey,
                payload: JSON.parse(JSON.stringify(row.payload)) as Prisma.InputJsonValue,
              })),
            }),
            CORE_SERVING_REBUILD_DB_WRITE_TIMEOUT_MS,
            "core_serving_cache_write"
          );
        }
      } catch (error) {
        const classified = classifyDatabaseError(error);
        if (!isRelationMissingError(error)) {
          bumpFailureCategory(failureStats, classified.category);
          console.warn(
            `[fund-detail-core-serving] ScoresApiCache checkpoint write skipped category=${classified.category} message=${classified.message}`
          );
        } else {
          console.warn("[fund-detail-core-serving] ScoresApiCache missing; checkpoint file write only");
        }
      }
      return true;
    } catch (error) {
      console.error("[fund-detail-core-serving-rebuild] checkpoint_artifact_write_failed", error);
      return false;
    }
  }

  for (const latestRow of candidateFunds) {
    let lastErrorCategory: string | null = null;
    let built = false;
    let skipped = false;
    for (let attempt = 0; attempt <= CORE_SERVING_REBUILD_FUND_RETRIES; attempt += 1) {
      if (attempt > 0) {
        failureStats.retries += 1;
      }
      try {
        failureStats.snapshotReadAttempts += 1;
        const snapshotRows = await readFundSnapshotRowsForRebuild({
          fundId: latestRow.fundId,
          snapshotDate,
          fromDate,
        });
        if (snapshotRows.length === 0) {
          skippedFunds += 1;
          skipped = true;
          built = true;
          break;
        }
        scannedRows += snapshotRows.length;
        const snapshotDensePoints = snapshotRows
          .filter((row) => Number.isFinite(row.lastPrice) && row.lastPrice > 0)
          .map((row) => ({
            t: row.date.getTime(),
            p: row.lastPrice,
            d: Number.isFinite(row.dailyReturn) ? row.dailyReturn : null,
            i: Number.isFinite(row.investorCount) ? Math.max(0, Math.round(row.investorCount)) : null,
            s: Number.isFinite(row.portfolioSize) && row.portfolioSize > 0 ? row.portfolioSize : null,
          })) satisfies FundDetailHistoryServingPoint[];

        let historyAttempted = false;
        let historyErrorCategory: string | null = null;
        let historyHybrid: ChartHistoryBuildInput = { mode: "none", points: [], minDate: null, maxDate: null };
        if (
          CORE_SERVING_HISTORY_ENABLED &&
          snapshotDensePoints.length < CORE_SERVING_REBUILD_HISTORY_FOR_SNAPSHOT_POINTS_BELOW
        ) {
          failureStats.historyFallbackAttempts += 1;
          const historyRead = await readFundPriceHistoryForRebuild({
            fundId: latestRow.fundId,
            snapshotDate,
          });
          historyAttempted = historyRead.attempted;
          historyErrorCategory = historyRead.errorCategory;
          historyHybrid = buildHybridHistoryServingPoints(historyRead.rows);
        }

        const mergedByTs = new Map<number, FundDetailHistoryServingPoint>();
        for (const point of snapshotDensePoints) mergedByTs.set(point.t, point);
        for (const point of historyHybrid.points) mergedByTs.set(point.t, point);
        const chartHistory = buildHybridHistoryServingFromPoints([...mergedByTs.values()]);
        const payload = buildServingPayloadFromSnapshots(
          snapshotRows,
          {
            ...chartHistory,
            metadata: {
              source: historyHybrid.points.length > 0 ? "snapshot_plus_history" : "snapshot_only",
              snapshotPoints: snapshotDensePoints.length,
              historyPoints: historyHybrid.points.length,
              historyAttempted,
              historyErrorCategory,
            },
          },
          {
            mergedPoints: [...mergedByTs.values()],
            historyAttempted,
            historyErrorCategory,
          }
        );
        if (!payload) {
          throw new Error("serving_payload_build_failed");
        }
        servingRows.push({
          code: latestRow.code,
          cacheKey: coreServingCacheKey(latestRow.code),
          payload,
        });
        if (checkpointEvery > 0) {
          while (servingRows.length >= checkpointEvery) {
            const batch = servingRows.slice(0, checkpointEvery);
            const ok = await flushServingRowsBatch(batch);
            if (!ok) {
              break;
            }
            servingRows.splice(0, checkpointEvery);
          }
        }
        if (historyErrorCategory) bumpFailureCategory(failureStats, historyErrorCategory);
        built = true;
        break;
      } catch (error) {
        const classified = classifyDatabaseError(error);
        lastErrorCategory = classified.category;
        bumpFailureCategory(failureStats, classified.category);
        if (classified.category === "query_execution_timeout" || classified.category === "pool_checkout_timeout") {
          failureStats.snapshotReadTimeoutCount += 1;
        }
        if (attempt >= CORE_SERVING_REBUILD_FUND_RETRIES) {
          break;
        }
        const backoff = Math.min(2_000, 300 * 2 ** attempt);
        await sleepMs(backoff);
      }
    }
    processedFunds += 1;
    if (built && !skipped) {
      succeededFunds += 1;
    } else if (!built) {
      failedFunds += 1;
      failureStats.failedChunks += 1;
      console.warn(
        `[fund-detail-core-serving-rebuild] fund_failed code=${latestRow.code} category=${lastErrorCategory ?? "unknown"}`
      );
    }
    await sleepMs(CORE_SERVING_REBUILD_INTER_CHUNK_DELAY_MS);
  }

  let writtenRecords = lastTotalRecords;
  let mergedFromExistingRecords = firstMergedFromExisting ?? 0;
  if (servingRows.length > 0) {
    const ok = await flushServingRowsBatch(servingRows);
    if (ok) {
      servingRows.length = 0;
    } else {
      console.error("[fund-detail-core-serving-rebuild] final_artifact_write_failed");
      try {
        const disk = await loadServingRecordsMapFromDisk();
        writtenRecords = disk.existingFileUnreadable ? lastTotalRecords : disk.map.size;
      } catch {
        writtenRecords = lastTotalRecords;
      }
    }
  } else if (!replacedArtifact) {
    try {
      const disk = await loadServingRecordsMapFromDisk();
      writtenRecords = disk.existingFileUnreadable ? 0 : disk.map.size;
    } catch {
      writtenRecords = 0;
    }
    mergedFromExistingRecords = 0;
  }

  const writtenThisRun = totalArtifactCommitted;
  const partialMerge = replacedArtifact && mergedFromExistingRecords > 0;

  return {
    written: writtenThisRun,
    writtenThisRun,
    writtenRecords,
    rebuildMode,
    universeFundsTotal,
    partialMerge,
    replacedArtifact,
    mergedFromExistingRecords,
    scannedRows,
    snapshotDate: snapshotDateIso,
    candidateFunds: candidateFunds.length,
    processedFunds,
    succeededFunds,
    failedFunds,
    skippedFunds,
    retries: failureStats.retries,
    failedChunks: failureStats.failedChunks,
    snapshotReadAttempts: failureStats.snapshotReadAttempts,
    snapshotReadTimeoutCount: failureStats.snapshotReadTimeoutCount,
    historyFallbackAttempts: failureStats.historyFallbackAttempts,
    fullyCompleted: failedFunds === 0 && processedFunds === candidateFunds.length,
    checkpointFlushes,
    elapsedMs: Date.now() - startedAt,
    timeoutStats: {
      poolCheckoutTimeout: failureStats.poolCheckoutTimeout,
      statementTimeout: failureStats.statementTimeout,
      transactionTimeout: failureStats.transactionTimeout,
      connectionClosed: failureStats.connectionClosed,
    },
  };
}

export async function getFundDetailCoreServingCached(
  code: string,
  options?: FundDetailCoreServingReadOptions
): Promise<FundDetailCoreServingReadResult> {
  const normalizedCode = code.trim().toUpperCase();
  const startedAt = Date.now();
  if (!normalizedCode) {
    return { payload: null, source: "miss", readMs: Date.now() - startedAt, ageMs: null, missReason: "file_empty" };
  }

  const memory = getCoreServingMemory();
  const memoryEntry = memory.get(normalizedCode);
  if (memoryEntry && Date.now() - memoryEntry.cachedAt <= CORE_SERVING_MEMORY_TTL_MS) {
    const generatedAt = Date.parse(memoryEntry.payload.generatedAt);
    const ageMs = Number.isFinite(generatedAt) ? Math.max(0, Date.now() - generatedAt) : null;
    return { payload: memoryEntry.payload, source: "memory", readMs: Date.now() - startedAt, ageMs };
  }

  const fileRead = await getFundDetailCoreServingFromFile(normalizedCode);
  if (fileRead.payload) {
    memory.set(normalizedCode, { payload: fileRead.payload, cachedAt: Date.now() });
    const generatedAt = Date.parse(fileRead.payload.generatedAt);
    const ageMs = Number.isFinite(generatedAt) ? Math.max(0, Date.now() - generatedAt) : null;
    return { payload: fileRead.payload, source: "file", readMs: Date.now() - startedAt, ageMs };
  }
  let missReason: FundDetailCoreServingReadResult["missReason"] = fileRead.missReason ?? undefined;
  if (options?.preferFileOnly) {
    if (missReason === "file_missing" || missReason === "file_parse_error" || missReason === "file_empty") {
      void startCoreServingBootstrap(missReason);
    }
    return { payload: null, source: "miss", readMs: Date.now() - startedAt, ageMs: null, missReason };
  }

  try {
    const row = await prisma.scoresApiCache.findUnique({
      where: { cacheKey: coreServingCacheKey(normalizedCode) },
      select: { payload: true },
    });
    const payload = parseServingPayload(row?.payload);
    if (!payload) {
      missReason = missReason ?? "db_miss";
      if (!CORE_SERVING_ON_DEMAND_ENABLED) {
        void startCoreServingBootstrap(missReason);
        return { payload: null, source: "miss", readMs: Date.now() - startedAt, ageMs: null, missReason };
      }
      try {
        const ondemandPayload = await withTimeout(
          buildFundDetailCoreServingPayloadOnDemand(normalizedCode),
          CORE_SERVING_ON_DEMAND_TIMEOUT_MS,
          "fund_detail_core_ondemand"
        );
        if (!ondemandPayload) {
          void startCoreServingBootstrap("ondemand_empty");
          return {
            payload: null,
            source: "miss",
            readMs: Date.now() - startedAt,
            ageMs: null,
            missReason: "ondemand_empty",
          };
        }
        memory.set(normalizedCode, { payload: ondemandPayload, cachedAt: Date.now() });
        const generatedAt = Date.parse(ondemandPayload.generatedAt);
        const ageMs = Number.isFinite(generatedAt) ? Math.max(0, Date.now() - generatedAt) : null;
        return {
          payload: ondemandPayload,
          source: "ondemand",
          readMs: Date.now() - startedAt,
          ageMs,
        };
      } catch {
        void startCoreServingBootstrap("ondemand_failed");
        return {
          payload: null,
          source: "miss",
          readMs: Date.now() - startedAt,
          ageMs: null,
          missReason: "ondemand_failed",
        };
      }
    }

    memory.set(normalizedCode, { payload, cachedAt: Date.now() });
    const generatedAt = Date.parse(payload.generatedAt);
    const ageMs = Number.isFinite(generatedAt) ? Math.max(0, Date.now() - generatedAt) : null;
    return { payload, source: "db", readMs: Date.now() - startedAt, ageMs };
  } catch (error) {
    if (isRelationMissingError(error)) {
      void startCoreServingBootstrap(missReason ?? "db_miss");
      return { payload: null, source: "miss", readMs: Date.now() - startedAt, ageMs: null, missReason: missReason ?? "db_miss" };
    }
    if (!CORE_SERVING_ON_DEMAND_ENABLED) {
      throw error;
    }
    try {
      const ondemandPayload = await withTimeout(
        buildFundDetailCoreServingPayloadOnDemand(normalizedCode),
        CORE_SERVING_ON_DEMAND_TIMEOUT_MS,
        "fund_detail_core_ondemand"
      );
      if (!ondemandPayload) {
        void startCoreServingBootstrap("ondemand_empty");
        return {
          payload: null,
          source: "miss",
          readMs: Date.now() - startedAt,
          ageMs: null,
          missReason: "ondemand_empty",
        };
      }
      memory.set(normalizedCode, { payload: ondemandPayload, cachedAt: Date.now() });
      const generatedAt = Date.parse(ondemandPayload.generatedAt);
      const ageMs = Number.isFinite(generatedAt) ? Math.max(0, Date.now() - generatedAt) : null;
      return {
        payload: ondemandPayload,
        source: "ondemand",
        readMs: Date.now() - startedAt,
        ageMs,
      };
    } catch {
      void startCoreServingBootstrap("ondemand_failed");
      return {
        payload: null,
        source: "miss",
        readMs: Date.now() - startedAt,
        ageMs: null,
        missReason: "ondemand_failed",
      };
    }
  }
}

export async function getFundDetailCoreServingReadiness(options?: {
  includeDbCacheCount?: boolean;
}): Promise<{
  filePath: string;
  fileExists: boolean;
  fileRecordCount: number;
  fileMissReason: "file_missing" | "file_empty" | "file_parse_error" | null;
  dbCacheCount: number | null;
  dbMissReason: "cache_empty" | "build_failed" | null;
  bootstrap: {
    inFlight: boolean;
    status: "idle" | "running" | "ok" | "failed";
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastReason: string | null;
    lastError: string | null;
  };
}> {
  const fileState = getCoreServingFileState();
  let fileExists = false;
  let fileRecordCount = 0;
  let fileMissReason: "file_missing" | "file_empty" | "file_parse_error" | null = null;
  try {
    const stat = await fs.stat(CORE_SERVING_FILE_PATH);
    fileExists = stat.isFile();
    const probe = await getFundDetailCoreServingFromFile("__READINESS_PROBE__");
    fileRecordCount = fileState.records.size;
    // Readiness check'te dosyada kayıt varsa "probe code bulunamadı" durumunu miss olarak raporlamayız.
    if (fileExists && fileRecordCount > 0) {
      fileMissReason = null;
    } else {
      fileMissReason = probe.missReason;
      if (fileExists && fileRecordCount === 0 && fileMissReason == null) {
        fileMissReason = "file_empty";
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      fileExists = false;
      fileRecordCount = 0;
      fileMissReason = "file_missing";
    } else {
      fileExists = false;
      fileRecordCount = 0;
      fileMissReason = "file_parse_error";
    }
  }

  let dbCacheCount: number | null = null;
  let dbMissReason: "cache_empty" | "build_failed" | null = null;
  if (options?.includeDbCacheCount !== false) {
    try {
      dbCacheCount = await prisma.scoresApiCache.count({
        where: { cacheKey: { startsWith: `${CORE_SERVING_KEY_PREFIX}:` } },
      });
      if (dbCacheCount === 0) dbMissReason = "cache_empty";
    } catch (error) {
      dbCacheCount = null;
      dbMissReason = "build_failed";
    }
  }

  const bootstrapState = getCoreServingBootstrapState();
  return {
    filePath: CORE_SERVING_FILE_PATH,
    fileExists,
    fileRecordCount,
    fileMissReason,
    dbCacheCount,
    dbMissReason,
    bootstrap: {
      inFlight: Boolean(bootstrapState.inFlight),
      status: bootstrapState.status,
      lastStartedAt: bootstrapState.lastStartedAt > 0 ? new Date(bootstrapState.lastStartedAt).toISOString() : null,
      lastCompletedAt:
        bootstrapState.lastCompletedAt > 0 ? new Date(bootstrapState.lastCompletedAt).toISOString() : null,
      lastReason: bootstrapState.lastReason,
      lastError: bootstrapState.lastError,
    },
  };
}

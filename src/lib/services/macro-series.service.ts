import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import { fetchTcmbCpiRange, fetchTcmbOneWeekRepoRange } from "@/lib/services/tcmb-official-series.service";
import { fetchYahooDailySeries, type YahooDailyPoint } from "@/lib/services/yahoo-market-data.service";

const MACRO_SYNC_KEY = "macro_series";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BACKFILL_DAYS = 730;
const DEFAULT_DAILY_OVERLAP_DAYS = 14;
const DEFAULT_MONTHLY_OVERLAP_DAYS = 62;
const DEFAULT_STALE_RUN_MINUTES = 120;
const UPSERT_CHUNK = 100;
const TROY_OUNCE_GRAMS = 31.1034768;
const DEFAULT_API_WINDOW_DAYS = 730;
const MAX_API_WINDOW_DAYS = 3650;
const MAX_API_CODES = 10;
const DEFAULT_API_POINT_LIMIT = 400;
const MAX_API_POINT_LIMIT = 800;

function isMacroStateStoreTransientFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECHECKOUTTIMEOUT|pool after|connection: Error \{ kind: Closed|timeout/i.test(message);
}

type MacroFrequency = "daily" | "monthly" | "event";
type MacroSource = "yahoo" | "yahoo_derived" | "tcmb_web";

export type MacroSyncSeriesResult = {
  code: string;
  source: string;
  startDate: string;
  endDate: string;
  fetchedRows: number;
  writtenRows: number;
  skipped?: boolean;
  error?: string;
};

export type MacroSyncResult = {
  ok: boolean;
  partial: boolean;
  startDate: string;
  endDate: string;
  seriesCount: number;
  fetchedRows: number;
  writtenRows: number;
  touchedDates: number;
  series: MacroSyncSeriesResult[];
};

export type MacroHistorySyncRecoveryResult = {
  recovered: boolean;
  previousStatus: string | null;
  reason?: string;
};

type MacroPoint = {
  date: Date;
  value: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  meta?: Record<string, unknown>;
};

type MacroSeriesDefinition = {
  code: string;
  name: string;
  source: MacroSource;
  sourceSymbol: string | null;
  frequency: MacroFrequency;
  unit: string | null;
  currency: string | null;
  metadata: Record<string, unknown>;
  fetchRange: (startDate: Date, endDate: Date) => Promise<MacroPoint[]>;
};

export type MacroSeriesPayload = {
  code: string;
  name: string;
  source: string;
  sourceSymbol: string | null;
  frequency: string;
  unit: string | null;
  currency: string | null;
  metadata: Prisma.JsonValue | null;
  latest: {
    date: string;
    value: number;
    open: number | null;
    high: number | null;
    low: number | null;
    volume: number | null;
  } | null;
  availableRange: {
    startDate: string | null;
    endDate: string | null;
    totalPoints: number;
  };
  loadedPoints: number;
  points: Array<{
    date: string;
    value: number;
    open: number | null;
    high: number | null;
    low: number | null;
    volume: number | null;
  }>;
};

type MacroSeriesStats = {
  seriesId: string;
  totalPoints: number;
  startDate: Date | null;
  endDate: Date | null;
};

function normalizePositiveInteger(value: number | null | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value == null || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function serializeMacroPoint(point: {
  date: Date;
  value: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
}) {
  return {
    date: point.date.toISOString(),
    value: point.value,
    open: point.open,
    high: point.high,
    low: point.low,
    volume: point.volume,
  };
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function formatIsoDay(date: Date): string {
  return startOfUtcDay(date).toISOString();
}

function asDetailsRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function addDays(date: Date, days: number): Date {
  return startOfUtcDay(new Date(date.getTime() + days * DAY_MS));
}

function clampPoint(point: MacroPoint): MacroPoint | null {
  if (!Number.isFinite(point.value) || point.value <= 0) return null;
  return {
    date: startOfUtcDay(point.date),
    value: Number(point.value),
    open: point.open != null && Number.isFinite(point.open) ? Number(point.open) : null,
    high: point.high != null && Number.isFinite(point.high) ? Number(point.high) : null,
    low: point.low != null && Number.isFinite(point.low) ? Number(point.low) : null,
    volume: point.volume != null && Number.isFinite(point.volume) ? Number(point.volume) : null,
    meta: point.meta,
  };
}

async function fetchBist100Range(startDate: Date, endDate: Date): Promise<MacroPoint[]> {
  const points = await fetchYahooDailySeries("XU100.IS", startDate, endDate);
  return points.map((point) => ({
    date: point.date,
    value: point.value,
    open: point.open,
    high: point.high,
    low: point.low,
    volume: point.volume,
    meta: { currency: point.currency },
  }));
}

async function fetchUsdTrySeriesRange(startDate: Date, endDate: Date): Promise<MacroPoint[]> {
  const points = await fetchYahooDailySeries("TRY=X", startDate, endDate);
  return points.map((point) => ({
    date: point.date,
    value: point.value,
    open: point.open,
    high: point.high,
    low: point.low,
    volume: point.volume,
    meta: { currency: point.currency },
  }));
}

async function fetchEurUsdRange(startDate: Date, endDate: Date): Promise<Map<number, YahooDailyPoint>> {
  const points = await fetchYahooDailySeries("EURUSD=X", startDate, endDate);
  return new Map(points.map((point) => [point.date.getTime(), point]));
}

async function fetchEurTrySeriesRange(startDate: Date, endDate: Date): Promise<MacroPoint[]> {
  const [eurUsd, usdTry] = await Promise.all([
    fetchEurUsdRange(startDate, endDate),
    fetchUsdTryRange(startDate, endDate),
  ]);

  const timestamps = [...eurUsd.keys()].sort((a, b) => a - b);
  const out: MacroPoint[] = [];
  for (const ts of timestamps) {
    const eurUsdPoint = eurUsd.get(ts);
    const usdTryPoint = usdTry.get(ts);
    if (!eurUsdPoint || !usdTryPoint || eurUsdPoint.value <= 0 || usdTryPoint.value <= 0) continue;

    out.push({
      date: eurUsdPoint.date,
      value: eurUsdPoint.value * usdTryPoint.value,
      open:
        eurUsdPoint.open != null && usdTryPoint.open != null ? eurUsdPoint.open * usdTryPoint.open : null,
      high:
        eurUsdPoint.high != null && usdTryPoint.high != null ? eurUsdPoint.high * usdTryPoint.high : null,
      low:
        eurUsdPoint.low != null && usdTryPoint.low != null ? eurUsdPoint.low * usdTryPoint.low : null,
      volume: eurUsdPoint.volume ?? usdTryPoint.volume,
      meta: {
        derivedFrom: ["EURUSD=X", "TRY=X"],
        eurUsdCurrency: eurUsdPoint.currency,
        usdTryCurrency: usdTryPoint.currency,
        formula: "eur_usd * usd_try",
      },
    });
  }

  return out;
}

async function fetchUsdTryRange(startDate: Date, endDate: Date): Promise<Map<number, YahooDailyPoint>> {
  const points = await fetchYahooDailySeries("TRY=X", startDate, endDate);
  return new Map(points.map((point) => [point.date.getTime(), point]));
}

async function fetchGoldTryGramRange(startDate: Date, endDate: Date): Promise<MacroPoint[]> {
  const [goldOunceUsd, usdTry] = await Promise.all([
    fetchYahooDailySeries("GC=F", startDate, endDate),
    fetchUsdTryRange(startDate, endDate),
  ]);

  const out: MacroPoint[] = [];
  for (const goldPoint of goldOunceUsd) {
    const fxPoint = usdTry.get(goldPoint.date.getTime());
    if (!fxPoint || fxPoint.value <= 0) continue;

    const gramTry = (goldPoint.value / TROY_OUNCE_GRAMS) * fxPoint.value;
    out.push({
      date: goldPoint.date,
      value: gramTry,
      open: goldPoint.open != null ? (goldPoint.open / TROY_OUNCE_GRAMS) * fxPoint.value : null,
      high: goldPoint.high != null ? (goldPoint.high / TROY_OUNCE_GRAMS) * fxPoint.value : null,
      low: goldPoint.low != null ? (goldPoint.low / TROY_OUNCE_GRAMS) * fxPoint.value : null,
      volume: goldPoint.volume,
      meta: {
        derivedFrom: ["GC=F", "TRY=X"],
        goldCurrency: goldPoint.currency,
        fxCurrency: fxPoint.currency,
        formula: "(gold_ounce_usd / 31.1034768) * usd_try",
      },
    });
  }

  return out;
}

function getMacroSeriesDefinitions(): MacroSeriesDefinition[] {
  return [
    {
      code: "BIST100",
      name: "BIST 100",
      source: "yahoo",
      sourceSymbol: "XU100.IS",
      frequency: "daily",
      unit: "index_points",
      currency: "TRY",
      metadata: {
        provider: "Yahoo Finance",
        kind: "index_close",
      },
      fetchRange: fetchBist100Range,
    },
    {
      code: "USDTRY",
      name: "USD/TRY",
      source: "yahoo",
      sourceSymbol: "TRY=X",
      frequency: "daily",
      unit: "TRY_per_USD",
      currency: "TRY",
      metadata: {
        provider: "Yahoo Finance",
        kind: "fx_spot",
        baseCurrency: "USD",
        quoteCurrency: "TRY",
      },
      fetchRange: fetchUsdTrySeriesRange,
    },
    {
      code: "EURTRY",
      name: "EUR/TRY",
      source: "yahoo_derived",
      sourceSymbol: "EURUSD=X + TRY=X",
      frequency: "daily",
      unit: "TRY_per_EUR",
      currency: "TRY",
      metadata: {
        provider: "Yahoo Finance",
        kind: "derived_series",
        baseCurrency: "EUR",
        quoteCurrency: "TRY",
        components: ["EURUSD=X", "TRY=X"],
      },
      fetchRange: fetchEurTrySeriesRange,
    },
    {
      code: "GOLD_TRY_GRAM",
      name: "Gram Altın",
      source: "yahoo_derived",
      sourceSymbol: "GC=F + TRY=X",
      frequency: "daily",
      unit: "TRY_per_gram",
      currency: "TRY",
      metadata: {
        provider: "Yahoo Finance",
        kind: "derived_series",
        components: ["GC=F", "TRY=X"],
      },
      fetchRange: fetchGoldTryGramRange,
    },
    {
      code: "CPI_TR_YOY",
      name: "TÜFE Yıllık Değişim",
      source: "tcmb_web",
      sourceSymbol: "Tuketici Fiyatlari",
      frequency: "monthly",
      unit: "percent",
      currency: null,
      metadata: {
        provider: "TCMB",
        kind: "cpi_yoy",
        page: "Tüketici Fiyatları",
      },
      fetchRange: (startDate, endDate) =>
        fetchTcmbCpiRange(startDate, endDate, "yearly").then((points) =>
          points.map((point) => ({
            date: point.date,
            value: point.value,
          }))
        ),
    },
    {
      code: "CPI_TR_MOM",
      name: "TÜFE Aylık Değişim",
      source: "tcmb_web",
      sourceSymbol: "Tuketici Fiyatlari",
      frequency: "monthly",
      unit: "percent",
      currency: null,
      metadata: {
        provider: "TCMB",
        kind: "cpi_mom",
        page: "Tüketici Fiyatları",
      },
      fetchRange: (startDate, endDate) =>
        fetchTcmbCpiRange(startDate, endDate, "monthly").then((points) =>
          points.map((point) => ({
            date: point.date,
            value: point.value,
          }))
        ),
    },
    {
      code: "TCMB_POLICY_RATE",
      name: "TCMB Politika Faizi",
      source: "tcmb_web",
      sourceSymbol: "1_Hafta_Repo",
      frequency: "event",
      unit: "percent",
      currency: null,
      metadata: {
        provider: "TCMB",
        kind: "policy_rate",
        page: "1 Hafta Repo",
      },
      fetchRange: (startDate, endDate) =>
        fetchTcmbOneWeekRepoRange(startDate, endDate).then((points) =>
          points.map((point) => ({
            date: point.date,
            value: point.value,
          }))
        ),
    },
  ];
}

async function upsertMacroSeries(definition: MacroSeriesDefinition): Promise<{ id: string; code: string }> {
  const row = await prisma.macroSeries.upsert({
    where: { code: definition.code },
    create: {
      code: definition.code,
      name: definition.name,
      source: definition.source,
      sourceSymbol: definition.sourceSymbol,
      frequency: definition.frequency,
      unit: definition.unit,
      currency: definition.currency,
      metadata: toJson(definition.metadata),
    },
    update: {
      name: definition.name,
      source: definition.source,
      sourceSymbol: definition.sourceSymbol,
      frequency: definition.frequency,
      unit: definition.unit,
      currency: definition.currency,
      metadata: toJson(definition.metadata),
      isActive: true,
    },
    select: { id: true, code: true },
  });

  return row;
}

async function writeMacroPoints(seriesId: string, points: MacroPoint[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < points.length; i += UPSERT_CHUNK) {
    const slice = points.slice(i, i + UPSERT_CHUNK);
    await prisma.$transaction(
      slice.map((point) =>
        prisma.macroObservation.upsert({
          where: {
            seriesId_date: {
              seriesId,
              date: point.date,
            },
          },
          create: {
            seriesId,
            date: point.date,
            value: point.value,
            open: point.open ?? null,
            high: point.high ?? null,
            low: point.low ?? null,
            volume: point.volume ?? null,
            meta: point.meta ? toJson(point.meta) : Prisma.JsonNull,
          },
          update: {
            value: point.value,
            open: point.open ?? null,
            high: point.high ?? null,
            low: point.low ?? null,
            volume: point.volume ?? null,
            meta: point.meta ? toJson(point.meta) : Prisma.JsonNull,
          },
        })
      )
    );
    written += slice.length;
  }
  return written;
}

async function syncDefinitionRange(
  definition: MacroSeriesDefinition,
  startDate: Date,
  endDate: Date
): Promise<MacroSyncSeriesResult> {
  const rangeStart = startOfUtcDay(startDate);
  const rangeEnd = startOfUtcDay(endDate);
  const seriesRow = await upsertMacroSeries(definition);

  try {
    const rawPoints = await definition.fetchRange(rangeStart, rangeEnd);
    const normalized = rawPoints.map(clampPoint).filter((point): point is MacroPoint => point != null);
    const deduped = new Map(normalized.map((point) => [point.date.getTime(), point]));
    const points = [...deduped.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
    const writtenRows = await writeMacroPoints(seriesRow.id, points);

    await prisma.macroSeries.update({
      where: { id: seriesRow.id },
      data: { lastSyncedAt: new Date() },
    });

    return {
      code: definition.code,
      source: definition.source,
      startDate: formatIsoDay(rangeStart),
      endDate: formatIsoDay(rangeEnd),
      fetchedRows: points.length,
      writtenRows,
    };
  } catch (error) {
    return {
      code: definition.code,
      source: definition.source,
      startDate: formatIsoDay(rangeStart),
      endDate: formatIsoDay(rangeEnd),
      fetchedRows: 0,
      writtenRows: 0,
      skipped: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runSyncForDefinitions(definitions: MacroSeriesDefinition[], rangeByCode: Map<string, Date>, endDate: Date): Promise<MacroSyncResult> {
  const results: MacroSyncSeriesResult[] = [];

  for (const definition of definitions) {
    const startDate = rangeByCode.get(definition.code) ?? addDays(endDate, -DEFAULT_BACKFILL_DAYS);
    results.push(await syncDefinitionRange(definition, startDate, endDate));
  }

  const writtenRows = results.reduce((sum, item) => sum + item.writtenRows, 0);
  const fetchedRows = results.reduce((sum, item) => sum + item.fetchedRows, 0);
  const touchedDates = new Set(results.flatMap((item) => [item.startDate, item.endDate])).size;
  const failures = results.filter((item) => item.error);

  return {
    ok: failures.length === 0,
    partial: failures.length > 0,
    startDate: formatIsoDay(
      [...rangeByCode.values()].sort((a, b) => a.getTime() - b.getTime())[0] ?? addDays(endDate, -DEFAULT_BACKFILL_DAYS)
    ),
    endDate: formatIsoDay(endDate),
    seriesCount: definitions.length,
    fetchedRows,
    writtenRows,
    touchedDates,
    series: results,
  };
}

export async function syncMacroSeriesRange(options?: {
  startDate?: Date;
  endDate?: Date;
  seriesCodes?: string[];
}): Promise<MacroSyncResult> {
  const endDate = startOfUtcDay(options?.endDate ?? new Date());
  const startDate = startOfUtcDay(options?.startDate ?? addDays(endDate, -DEFAULT_BACKFILL_DAYS));
  const allowed = new Set(options?.seriesCodes ?? []);
  const definitions = getMacroSeriesDefinitions().filter((definition) => allowed.size === 0 || allowed.has(definition.code));
  const rangeByCode = new Map(definitions.map((definition) => [definition.code, startDate]));

  await prisma.macroSyncState.upsert({
    where: { key: MACRO_SYNC_KEY },
    create: {
      key: MACRO_SYNC_KEY,
      status: "RUNNING",
      lastStartedAt: new Date(),
      details: toJson({
        phase: "range_sync",
        requestedSeriesCodes: options?.seriesCodes ?? null,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      }),
    },
    update: {
      status: "RUNNING",
      lastStartedAt: new Date(),
      details: toJson({
        phase: "range_sync",
        requestedSeriesCodes: options?.seriesCodes ?? null,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      }),
    },
  });

  const result = await runSyncForDefinitions(definitions, rangeByCode, endDate);
  await refreshMacroSyncState({
    phase: "range_sync",
    result,
  });

  return result;
}

export async function appendRecentMacroSeries(
  dailyOverlapDays: number = DEFAULT_DAILY_OVERLAP_DAYS,
  monthlyOverlapDays: number = DEFAULT_MONTHLY_OVERLAP_DAYS
): Promise<MacroSyncResult> {
  const endDate = startOfUtcDay(new Date());
  const definitions = getMacroSeriesDefinitions();
  const existing = await prisma.macroSeries.findMany({
    where: { code: { in: definitions.map((definition) => definition.code) } },
    select: {
      code: true,
      observations: {
        take: 1,
        orderBy: { date: "desc" },
        select: { date: true },
      },
    },
  });

  const latestByCode = new Map(
    existing.map((row) => [row.code, row.observations[0]?.date ?? null] as const)
  );

  const rangeByCode = new Map<string, Date>();
  for (const definition of definitions) {
    const latestDate = latestByCode.get(definition.code) ?? null;
    const overlapDays = definition.frequency === "monthly" ? monthlyOverlapDays : dailyOverlapDays;
    rangeByCode.set(
      definition.code,
      latestDate ? addDays(latestDate, -overlapDays) : addDays(endDate, -DEFAULT_BACKFILL_DAYS)
    );
  }

  await prisma.macroSyncState.upsert({
    where: { key: MACRO_SYNC_KEY },
    create: {
      key: MACRO_SYNC_KEY,
      status: "RUNNING",
      lastStartedAt: new Date(),
      details: toJson({
        phase: "append",
        dailyOverlapDays,
        monthlyOverlapDays,
      }),
    },
    update: {
      status: "RUNNING",
      lastStartedAt: new Date(),
      details: toJson({
        phase: "append",
        dailyOverlapDays,
        monthlyOverlapDays,
      }),
    },
  });

  const result = await runSyncForDefinitions(definitions, rangeByCode, endDate);
  await refreshMacroSyncState({
    phase: "append",
    dailyOverlapDays,
    monthlyOverlapDays,
    result,
  });

  return result;
}

export async function refreshMacroSyncState(details?: Record<string, unknown>): Promise<void> {
  const [minDate, maxDate] = await Promise.all([
    prisma.macroObservation.findFirst({
      orderBy: { date: "asc" },
      select: { date: true },
    }),
    prisma.macroObservation.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    }),
  ]);

  const current = await prisma.macroSyncState.findUnique({
    where: { key: MACRO_SYNC_KEY },
    select: { details: true },
  });

  const mergedDetails = {
    ...asDetailsRecord(current?.details),
    ...asDetailsRecord(details),
  };

  await prisma.macroSyncState.upsert({
    where: { key: MACRO_SYNC_KEY },
    create: {
      key: MACRO_SYNC_KEY,
      status: "READY",
      earliestHistoryDate: minDate?.date ?? null,
      latestHistoryDate: maxDate?.date ?? null,
      lastCompletedAt: new Date(),
      details: toJson(mergedDetails),
    },
    update: {
      status: "READY",
      earliestHistoryDate: minDate?.date ?? null,
      latestHistoryDate: maxDate?.date ?? null,
      lastCompletedAt: new Date(),
      details: toJson(mergedDetails),
    },
  });
}

export async function recoverStaleMacroSyncState(
  staleAfterMinutes: number = DEFAULT_STALE_RUN_MINUTES
): Promise<MacroHistorySyncRecoveryResult> {
  let state: { status: string; lastStartedAt: Date | null } | null = null;
  try {
    state = await prisma.macroSyncState.findUnique({
      where: { key: MACRO_SYNC_KEY },
      select: {
        status: true,
        lastStartedAt: true,
      },
    });
  } catch (error) {
    if (!isMacroStateStoreTransientFailure(error)) throw error;
    return { recovered: false, previousStatus: null, reason: "state_store_unavailable" };
  }

  if (!state || state.status !== "RUNNING" || !state.lastStartedAt) {
    return { recovered: false, previousStatus: state?.status ?? null };
  }

  const cutoff = Date.now() - staleAfterMinutes * 60 * 1000;
  if (state.lastStartedAt.getTime() >= cutoff) {
    return { recovered: false, previousStatus: state.status };
  }

  await prisma.macroSyncState.update({
    where: { key: MACRO_SYNC_KEY },
    data: {
      status: "READY",
      lastCompletedAt: new Date(),
    },
  });

  return {
    recovered: true,
    previousStatus: state.status,
    reason: "stale_running_state",
  };
}

export async function getMacroSeriesData(options?: {
  codes?: string[];
  days?: number;
  includePoints?: boolean;
  pointLimit?: number;
}): Promise<MacroSeriesPayload[]> {
  const codes = options?.codes?.filter(Boolean).slice(0, MAX_API_CODES);
  const includePoints = Boolean(options?.includePoints);
  const effectiveWindowDays = normalizePositiveInteger(options?.days, DEFAULT_API_WINDOW_DAYS, MAX_API_WINDOW_DAYS);
  const fromDate = includePoints ? addDays(new Date(), -effectiveWindowDays) : null;
  const pointLimit = includePoints
    ? normalizePositiveInteger(options?.pointLimit, DEFAULT_API_POINT_LIMIT, MAX_API_POINT_LIMIT)
    : 1;

  const rows = await prisma.macroSeries.findMany({
    where: {
      isActive: true,
      ...(codes?.length ? { code: { in: codes } } : {}),
    },
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      source: true,
      sourceSymbol: true,
      frequency: true,
      unit: true,
      currency: true,
      metadata: true,
      observations: {
        where: fromDate ? { date: { gte: fromDate } } : undefined,
        orderBy: { date: "desc" },
        take: pointLimit,
        select: {
          date: true,
          value: true,
          open: true,
          high: true,
          low: true,
          volume: true,
        },
      },
    },
  });

  const statsRows = await prisma.macroObservation.groupBy({
    by: ["seriesId"],
    where: {
      seriesId: { in: rows.map((row) => row.id) },
    },
    _count: { _all: true },
    _min: { date: true },
    _max: { date: true },
  });

  const statsBySeriesId = new Map<string, MacroSeriesStats>(
    statsRows.map((row) => [
      row.seriesId,
      {
        seriesId: row.seriesId,
        totalPoints: row._count._all,
        startDate: row._min.date ?? null,
        endDate: row._max.date ?? null,
      },
    ])
  );

  return rows.map((row) => {
    const observations = includePoints ? [...row.observations].reverse() : row.observations;
    const latest = (includePoints ? observations[observations.length - 1] : observations[0]) ?? null;
    const stats = statsBySeriesId.get(row.id);
    return {
      code: row.code,
      name: row.name,
      source: row.source,
      sourceSymbol: row.sourceSymbol,
      frequency: row.frequency,
      unit: row.unit,
      currency: row.currency,
      metadata: row.metadata,
      latest: latest
        ? {
            date: latest.date.toISOString(),
            value: latest.value,
            open: latest.open,
            high: latest.high,
            low: latest.low,
            volume: latest.volume,
          }
        : null,
      availableRange: {
        startDate: stats?.startDate?.toISOString() ?? null,
        endDate: stats?.endDate?.toISOString() ?? null,
        totalPoints: stats?.totalPoints ?? 0,
      },
      loadedPoints: observations.length,
      points: includePoints ? observations.map(serializeMacroPoint) : [],
    };
  });
}

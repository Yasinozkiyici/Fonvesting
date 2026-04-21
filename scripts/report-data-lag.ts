/**
 * CI/ops: raw ingest → DB history → daily snapshot → serving head snapshotAsOf hizasını tek JSON'da özetler.
 * Amaç: "hangi katmanda takıldık?" sorusunu hızlıca cevaplamak.
 */
import "./load-env";
import { prisma, resetPrismaEngine } from "../src/lib/prisma";
import { readLatestServingHeadsMeta } from "../src/lib/data-platform/serving-head";
import { classifyDatabaseError } from "../src/lib/database-error-classifier";

function isoDay(d: Date | null | undefined): string | null {
  if (!d) return null;
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function dayMs(d: Date | null | undefined): number | null {
  if (!d) return null;
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function lagDays(a: Date | null, b: Date | null): number | null {
  const am = dayMs(a);
  const bm = dayMs(b);
  if (am == null || bm == null) return null;
  return Math.round((am - bm) / 86400000);
}

function resolveBaseUrl(): string {
  const keys = [
    "DATA_RELEASE_GATE_BASE_URL",
    "SMOKE_BASE_URL",
    "RELEASE_PREVIEW_URL",
    "NEXT_PUBLIC_BASE_URL",
    "NEXT_PUBLIC_SITE_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
  ];
  for (const key of keys) {
    const raw = String(process.env[key] ?? "").trim();
    if (!raw) continue;
    const normalized = raw.startsWith("http") ? raw : `https://${raw}`;
    return normalized.replace(/\/+$/, "");
  }
  return "https://fonvesting.vercel.app";
}

async function readHealthLagFallback() {
  const baseUrl = resolveBaseUrl();
  const response = await fetch(`${baseUrl}/api/health?mode=full`, {
    headers: { "x-health-secret": String(process.env.HEALTH_SECRET ?? "") },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`health_fetch_failed status=${response.status}`);
  const payload = await response.json();
  const truth = payload?.freshnessTruth ?? payload?.freshness?.canonicalTruth ?? {};
  return {
    generatedAt: new Date().toISOString(),
    proofSource: "health_api_fallback",
    rawPrices: {
      latestEffectiveDate: isoDay(truth?.rawSnapshotAsOf ?? null),
      latestFetchedAt: null,
    },
    fundPriceHistory: { latestDate: null },
    fundDailySnapshot: { latestDate: isoDay(truth?.fundSnapshotAsOf ?? payload?.freshness?.latestFundSnapshotDate ?? null) },
    serving: {
      latestSnapshotAsOf: isoDay(truth?.servingSnapshotAsOf ?? null),
      heads: {
        fundList: null,
        fundDetail: null,
        compare: null,
        discovery: null,
        system: null,
      },
    },
    lagDays: {
      rawEffectiveToHistory: null,
      historyToSnapshot: null,
      snapshotToServing: null,
    },
    latestSyncLog: null,
    fallbackReason: "db_pool_fragility",
  };
}

async function withDbRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const classified = classifyDatabaseError(error);
      if (!classified.retryable || attempt >= 3) throw error;
      console.warn(
        `[report-data-lag] transient_db_error label=${label} attempt=${attempt} class=${classified.category} ` +
          `prisma_code=${classified.prismaCode ?? "none"}`
      );
      await resetPrismaEngine();
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

async function main() {
  try {
    const latestSnapshot = await withDbRetry("fundDailySnapshot.findFirst", () =>
      prisma.fundDailySnapshot.findFirst({
        orderBy: { date: "desc" },
        select: { date: true },
      })
    );

    const rawPricesOk = await withDbRetry("rawPricesPayload.aggregate", () =>
      prisma.rawPricesPayload.aggregate({
        where: { source: "tefas_browser", parseStatus: "OK" },
        _max: { effectiveDate: true, fetchedAt: true },
      })
    );

    const latestSync = await withDbRetry("syncLog.findFirst", () =>
      prisma.syncLog.findFirst({
        orderBy: { startedAt: "desc" },
        select: { syncType: true, status: true, completedAt: true, startedAt: true, errorMessage: true },
      })
    );

    const heads = await withDbRetry("readLatestServingHeadsMeta", () => readLatestServingHeadsMeta());
    const servingCandidates = [
      heads.fundDetail?.snapshotAsOf,
      heads.discovery?.snapshotAsOf,
      heads.compare?.snapshotAsOf,
      heads.fundList?.snapshotAsOf,
      heads.system?.snapshotAsOf,
    ].filter((d): d is Date => Boolean(d));

    const latestServingAsOf =
      servingCandidates.length === 0
        ? null
        : servingCandidates.reduce((max, cur) => (cur.getTime() > max.getTime() ? cur : max));

    const out = {
      generatedAt: new Date().toISOString(),
      proofSource: "database",
      rawPrices: {
        latestEffectiveDate: isoDay(rawPricesOk._max.effectiveDate),
        latestFetchedAt: isoDay(rawPricesOk._max.fetchedAt),
      },
      fundPriceHistory: { latestDate: null },
      fundDailySnapshot: { latestDate: isoDay(latestSnapshot?.date) },
      serving: {
        latestSnapshotAsOf: isoDay(latestServingAsOf),
        heads: {
          fundList: heads.fundList ? isoDay(heads.fundList.snapshotAsOf) : null,
          fundDetail: heads.fundDetail ? isoDay(heads.fundDetail.snapshotAsOf) : null,
          compare: heads.compare ? isoDay(heads.compare.snapshotAsOf) : null,
          discovery: heads.discovery ? isoDay(heads.discovery.snapshotAsOf) : null,
          system: heads.system ? isoDay(heads.system.snapshotAsOf) : null,
        },
      },
      lagDays: {
        rawEffectiveToHistory: null,
        historyToSnapshot: null,
        snapshotToServing: lagDays(latestSnapshot?.date ?? null, latestServingAsOf),
      },
      latestSyncLog: latestSync
        ? {
            syncType: latestSync.syncType,
            status: latestSync.status,
            startedAt: isoDay(latestSync.startedAt),
            completedAt: isoDay(latestSync.completedAt),
            errorMessage: latestSync.errorMessage,
          }
        : null,
    };

    console.log(JSON.stringify(out, null, 2));
  } catch (error) {
    const classified = classifyDatabaseError(error);
    if (!classified.retryable) throw error;
    console.warn(
      `[report-data-lag] db_fragility_fallback_to_health class=${classified.category} prisma_code=${classified.prismaCode ?? "none"}`
    );
    const fallback = await readHealthLagFallback();
    console.log(JSON.stringify(fallback, null, 2));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });

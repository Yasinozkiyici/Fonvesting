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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });

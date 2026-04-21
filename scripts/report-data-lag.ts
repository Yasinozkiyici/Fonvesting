/**
 * CI/ops: raw ingest → DB history → daily snapshot → serving head snapshotAsOf hizasını tek JSON'da özetler.
 * Amaç: "hangi katmanda takıldık?" sorusunu hızlıca cevaplamak.
 */
import "./load-env";
import { prisma } from "../src/lib/prisma";
import { readLatestServingHeadsMeta } from "../src/lib/data-platform/serving-head";

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

async function main() {
  const latestHistory = await prisma.fundPriceHistory.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });

  const latestSnapshot = await prisma.fundDailySnapshot.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });

  const rawPricesOk = await prisma.rawPricesPayload.aggregate({
    where: { source: "tefas_browser", parseStatus: "OK" },
    _max: { effectiveDate: true, fetchedAt: true },
  });

  const latestSync = await prisma.syncLog.findFirst({
    orderBy: { startedAt: "desc" },
    select: { syncType: true, status: true, completedAt: true, startedAt: true, errorMessage: true },
  });

  const heads = await readLatestServingHeadsMeta();
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
    fundPriceHistory: { latestDate: isoDay(latestHistory?.date) },
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
      rawEffectiveToHistory: lagDays(rawPricesOk._max.effectiveDate ?? null, latestHistory?.date ?? null),
      historyToSnapshot: lagDays(latestHistory?.date ?? null, latestSnapshot?.date ?? null),
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

import "../load-env";
import { getSystemHealthSnapshot } from "../../src/lib/system-health";
import { readLatestServingHeads } from "../../src/lib/data-platform/serving-head";
import { prisma } from "../../src/lib/prisma";

async function main() {
  const [snapshot, servingHeads, rawStats] = await Promise.all([
    getSystemHealthSnapshot({ lightweight: false, includeExternalProbes: false }),
    readLatestServingHeads().catch(() => null),
    Promise.all([
      prisma.rawPricesPayload.findFirst({ orderBy: { fetchedAt: "desc" }, select: { fetchedAt: true } }).catch(() => null),
      prisma.rawPricesPayload.count({ where: { parseStatus: "FAILED" } }).catch(() => -1),
    ]).then(([latestRaw, parseFailures]) => ({
      latestRawFetchAt: latestRaw?.fetchedAt?.toISOString() ?? null,
      parseFailures,
    })),
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    systemHealth: snapshot,
    servingHeads,
    v2Pipeline: {
      latestRawFetchAt: rawStats.latestRawFetchAt,
      parseFailures: rawStats.parseFailures,
      latestCanonicalSnapshotDate: snapshot.freshness.latestFundSnapshotDate,
      latestServingBuildId: servingHeads?.system?.buildId ?? null,
    },
    dailyReliability: {
      dailySync: snapshot.jobs.dailySync,
      dailySyncStatus: snapshot.jobs.dailySyncStatus,
      latestFundSnapshotDate: snapshot.freshness.latestFundSnapshotDate,
      latestMarketSnapshotDate: snapshot.freshness.latestMarketSnapshotDate,
      servingStatus: snapshot.status,
      missedRunDetected: snapshot.issues.some((issue) =>
        ["daily_sync_missed_sla", "daily_sync_not_completed_today", "daily_sync_publish_lag"].includes(issue.code)
      ),
      anomalyDetected: snapshot.issues.some((issue) =>
        ["daily_sync_empty_source_anomaly", "daily_sync_partial_source_failure"].includes(issue.code)
      ),
    },
  };
  console.log(JSON.stringify(report, null, 2));
  const strict = process.argv.includes("--strict");
  process.exit(strict && !snapshot.ok ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

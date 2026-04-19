/**
 * Phase A uçtan uca kanıt: beklenen iş günü oturumu, DB history, snapshot, v2 serving başlıkları.
 * `pnpm exec tsx scripts/phase-a-chain-evidence.ts`
 * `--gate`: history beklenen oturuma yetişmiyorsa veya snapshot yoksa exit 1.
 */
import "./load-env";
import { prisma } from "../src/lib/prisma";
import { latestExpectedBusinessSessionDate, toIstanbulDateKey } from "../src/lib/daily-sync-policy";
import { startOfUtcDay } from "../src/lib/trading-calendar-tr";
import { readLatestServingHeadsMeta } from "../src/lib/data-platform/serving-head";
import { getSystemHealthSnapshot } from "../src/lib/system-health";

function isAtLeastExpectedSession(date: Date | null, expected: Date): boolean {
  return Boolean(date && startOfUtcDay(date).getTime() >= startOfUtcDay(expected).getTime());
}

async function main() {
  const gate = process.argv.includes("--gate");
  const expectedSession = latestExpectedBusinessSessionDate();

  const [latestHist, latestSnap, heads, health] = await Promise.all([
    prisma.fundPriceHistory.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    prisma.fundDailySnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    readLatestServingHeadsMeta().catch(() => null),
    getSystemHealthSnapshot({ lightweight: true, includeExternalProbes: false }).catch(() => null),
  ]);

  const historyVerifyOk = isAtLeastExpectedSession(latestHist?.date ?? null, expectedSession);
  const snapshotAligned =
    latestSnap?.date != null &&
    latestHist?.date != null &&
    startOfUtcDay(latestSnap.date).getTime() === startOfUtcDay(latestHist.date).getTime();

  const v2 = heads
    ? {
        fundListBuildId: heads.fundList?.buildId ?? null,
        systemBuildId: heads.system?.buildId ?? null,
        systemSnapshotAsOf:
          heads.system?.snapshotAsOf instanceof Date
            ? heads.system.snapshotAsOf.toISOString()
            : heads.system?.snapshotAsOf != null
              ? String(heads.system.snapshotAsOf)
              : null,
      }
    : { error: "serving_heads_unavailable" };

  const dbLatestSnapshotIso = latestSnap?.date.toISOString() ?? null;
  const healthFresh = health?.freshness.latestFundSnapshotDate ?? null;
  const evidence = {
    generatedAt: new Date().toISOString(),
    expectedBusinessSessionDate: expectedSession.toISOString(),
    expectedSessionIstanbulDateKey: toIstanbulDateKey(expectedSession),
    latestFundPriceHistoryDate: latestHist?.date.toISOString() ?? null,
    latestHistoryIstanbulDateKey: toIstanbulDateKey(latestHist?.date ?? null),
    historyVerifyOk,
    latestFundDailySnapshotDate: dbLatestSnapshotIso,
    snapshotMatchesLatestHistory: snapshotAligned,
    /** Health; ping-degraded pathunda REST yoksa null olabildiği için DB ile birlikte okunmalı. */
    healthFreshnessLatestFundSnapshotDate: healthFresh,
    healthFreshnessAlignedWithDb:
      healthFresh == null || dbLatestSnapshotIso == null ? null : healthFresh.slice(0, 10) === dbLatestSnapshotIso.slice(0, 10),
    healthStatus: health?.status ?? null,
    v2ServingHeads: v2,
    gateMode: gate,
  };

  console.log(JSON.stringify(evidence, null, 2));

  if (gate) {
    if (!historyVerifyOk) {
      console.error(
        `[phase-a-gate] FAIL history_stale expected=${expectedSession.toISOString()} latest=${latestHist?.date.toISOString() ?? "none"}`
      );
      process.exit(1);
    }
    if (!latestSnap?.date) {
      console.error("[phase-a-gate] FAIL missing_fund_daily_snapshot");
      process.exit(1);
    }
    if (!snapshotAligned) {
      console.error(
        `[phase-a-gate] FAIL snapshot_history_mismatch snap=${latestSnap.date.toISOString()} hist=${latestHist?.date.toISOString() ?? "none"}`
      );
      process.exit(1);
    }
    if (!heads?.fundList?.buildId || !heads?.system?.buildId) {
      console.error("[phase-a-gate] FAIL v2_serving_heads_incomplete");
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

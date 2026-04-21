/**
 * Phase A uçtan uca kanıt: beklenen iş günü oturumu, DB history, snapshot, v2 serving başlıkları.
 * `pnpm exec tsx scripts/phase-a-chain-evidence.ts`
 * `--gate`: history beklenen oturuma yetişmiyorsa veya snapshot yoksa exit 1.
 */
import "./load-env";
import { prisma, resetPrismaEngine } from "../src/lib/prisma";
import { latestExpectedBusinessSessionDate, toIstanbulDateKey } from "../src/lib/daily-sync-policy";
import { startOfUtcDay } from "../src/lib/trading-calendar-tr";
import { readLatestServingHeadsMeta } from "../src/lib/data-platform/serving-head";
import { getSystemHealthSnapshot } from "../src/lib/system-health";
import { classifyDatabaseError } from "../src/lib/database-error-classifier";

function isAtLeastExpectedSession(date: Date | null, expected: Date): boolean {
  return Boolean(date && startOfUtcDay(date).getTime() >= startOfUtcDay(expected).getTime());
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
        `[phase-a-gate] transient_db_error label=${label} attempt=${attempt} class=${classified.category} ` +
          `prisma_code=${classified.prismaCode ?? "none"}`
      );
      await resetPrismaEngine();
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

async function main() {
  const gate = process.argv.includes("--gate");
  const expectedSession = latestExpectedBusinessSessionDate();

  // Gate runs with low connection_limit in CI; serial reads avoid pool checkout timeouts.
  const latestHist = await withDbRetry("fundPriceHistory.findFirst", () =>
    prisma.fundPriceHistory.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    })
  );
  const latestSnap = await withDbRetry("fundDailySnapshot.findFirst", () =>
    prisma.fundDailySnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    })
  );
  const heads = await withDbRetry("readLatestServingHeadsMeta", () => readLatestServingHeadsMeta()).catch(() => null);
  const health = await withDbRetry("getSystemHealthSnapshot", () =>
    getSystemHealthSnapshot({ lightweight: true, includeExternalProbes: false })
  ).catch(() => null);

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

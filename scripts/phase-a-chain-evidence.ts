/**
 * Phase A uçtan uca kanıt: beklenen iş günü, snapshot ve serving başlıkları.
 * `pnpm exec tsx scripts/phase-a-chain-evidence.ts`
 * `--gate`: snapshot beklenen iş gününe yetişmiyorsa veya serving başlıkları eksikse exit 1.
 */
import "./load-env";
import { prisma, resetPrismaEngine } from "../src/lib/prisma";
import { latestExpectedBusinessSessionDate, toIstanbulDateKey } from "../src/lib/daily-sync-policy";
import { startOfUtcDay } from "../src/lib/trading-calendar-tr";
import { readLatestServingHeadsMeta } from "../src/lib/data-platform/serving-head";
import { classifyDatabaseError } from "../src/lib/database-error-classifier";

function isAtLeastExpectedSession(date: Date | null | undefined, expected: Date): boolean {
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

  // CI transaction pool modunda en hafif kanıt: fundDailySnapshot + serving head meta.
  // history tablosu Phase A gate için zorunlu değil; strict freshness script ham/snapshot/serving'i ayrıca doğrular.
  const latestSnap = await withDbRetry("fundDailySnapshot.findFirst", () =>
    prisma.fundDailySnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    })
  );
  const heads = await withDbRetry("readLatestServingHeadsMeta", () => readLatestServingHeadsMeta());
  const snapshotVerifyOk = isAtLeastExpectedSession(latestSnap?.date, expectedSession);
  const servingSnapshotCandidates = [
    heads.fundList?.snapshotAsOf,
    heads.system?.snapshotAsOf,
    heads.discovery?.snapshotAsOf,
    heads.compare?.snapshotAsOf,
    heads.fundDetail?.snapshotAsOf,
  ].filter((v): v is Date => v instanceof Date);
  const servingAsOf =
    servingSnapshotCandidates.length > 0
      ? servingSnapshotCandidates.reduce((max, cur) => (cur.getTime() > max.getTime() ? cur : max))
      : null;
  const servingVerifyOk = isAtLeastExpectedSession(servingAsOf, expectedSession);

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
  const evidence = {
    generatedAt: new Date().toISOString(),
    expectedBusinessSessionDate: expectedSession.toISOString(),
    expectedSessionIstanbulDateKey: toIstanbulDateKey(expectedSession),
    latestFundPriceHistoryDate: null,
    latestHistoryIstanbulDateKey: null,
    historyVerifyOk: null,
    latestFundDailySnapshotDate: dbLatestSnapshotIso,
    snapshotMatchesLatestHistory: null,
    snapshotVerifyOk,
    servingLatestSnapshotAsOf: servingAsOf?.toISOString() ?? null,
    servingVerifyOk,
    healthFreshnessLatestFundSnapshotDate: null,
    healthFreshnessAlignedWithDb: null,
    healthStatus: null,
    v2ServingHeads: v2,
    gateMode: gate,
  };

  console.log(JSON.stringify(evidence, null, 2));

  if (gate) {
    if (!latestSnap?.date) {
      console.error("[phase-a-gate] FAIL missing_fund_daily_snapshot");
      process.exit(1);
    }
    if (!snapshotVerifyOk) {
      console.error(
        `[phase-a-gate] FAIL snapshot_stale expected=${expectedSession.toISOString()} snap=${latestSnap.date.toISOString()}`
      );
      process.exit(1);
    }
    if (!heads?.fundList?.buildId || !heads?.system?.buildId) {
      console.error("[phase-a-gate] FAIL v2_serving_heads_incomplete");
      process.exit(1);
    }
    if (!servingVerifyOk) {
      console.error(
        `[phase-a-gate] FAIL serving_stale expected=${expectedSession.toISOString()} serving=${servingAsOf?.toISOString() ?? "none"}`
      );
      process.exit(1);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

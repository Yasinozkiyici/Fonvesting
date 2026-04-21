import "./load-env";
import { prisma, resetPrismaEngine } from "../src/lib/prisma";
import { readLatestServingHeadsMeta } from "../src/lib/data-platform/serving-head";
import { classifyDatabaseError } from "../src/lib/database-error-classifier";

const ISTANBUL_TZ = "Europe/Istanbul";

function formatDateInIstanbul(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ISTANBUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function weekdayInIstanbul(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ISTANBUL_TZ,
    weekday: "short",
  }).format(date);
}

function expectedBusinessDateIso(now: Date): string {
  const cursor = new Date(now.getTime());
  for (let i = 0; i < 7; i += 1) {
    const wd = weekdayInIstanbul(cursor);
    if (wd !== "Sat" && wd !== "Sun") return formatDateInIstanbul(cursor);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return formatDateInIstanbul(now);
}

function asDateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const iso = typeof value === "string" ? value : value.toISOString();
  return iso.slice(0, 10);
}

function maxDateOnly(values: Array<Date | null | undefined>): string | null {
  const normalized = values.map((v) => asDateOnly(v)).filter((v): v is string => Boolean(v)).sort();
  return normalized.length > 0 ? normalized[normalized.length - 1] : null;
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
        `[freshness-target] transient_db_error label=${label} attempt=${attempt} class=${classified.category} ` +
          `prisma_code=${classified.prismaCode ?? "none"}`
      );
      await resetPrismaEngine();
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

async function main() {
  const expected = expectedBusinessDateIso(new Date());
  const strict = process.argv.includes("--strict");

  // Serial reads reduce P2024 risk when connection_limit is intentionally tiny.
  const latestRaw = await withDbRetry("rawPricesPayload.findFirst", () =>
    prisma.rawPricesPayload.findFirst({
      orderBy: { effectiveDate: "desc" },
      select: { effectiveDate: true, fetchedAt: true, parseStatus: true },
    })
  );
  const latestFundSnapshot = await withDbRetry("fundDailySnapshot.findFirst", () =>
    prisma.fundDailySnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    })
  );
  const servingHeads = await withDbRetry("readLatestServingHeadsMeta", () => readLatestServingHeadsMeta());

  const servingAsOf = maxDateOnly([
    servingHeads?.fundList?.snapshotAsOf,
    servingHeads?.discovery?.snapshotAsOf,
    servingHeads?.compare?.snapshotAsOf,
    servingHeads?.fundDetail?.snapshotAsOf,
    servingHeads?.system?.snapshotAsOf,
  ]);

  const actualRaw = asDateOnly(latestRaw?.effectiveDate);
  const actualSnapshot = asDateOnly(latestFundSnapshot?.date);
  const gapRawDays =
    actualRaw && expected ? Math.round((Date.parse(expected) - Date.parse(actualRaw)) / 86400000) : null;
  const gapSnapshotDays =
    actualSnapshot && expected ? Math.round((Date.parse(expected) - Date.parse(actualSnapshot)) / 86400000) : null;
  const gapServingDays =
    servingAsOf && expected ? Math.round((Date.parse(expected) - Date.parse(servingAsOf)) / 86400000) : null;

  const report = {
    checkedAt: new Date().toISOString(),
    expectedLatestBusinessDate: expected,
    actualLatestRawSnapshotDate: actualRaw,
    actualLatestFundSnapshotDate: actualSnapshot,
    actualLatestServingSnapshotDate: servingAsOf,
    latestRawMeta: latestRaw
      ? {
          fetchedAt: latestRaw.fetchedAt.toISOString(),
          parseStatus: latestRaw.parseStatus,
        }
      : null,
    gapDays: {
      raw: gapRawDays,
      snapshot: gapSnapshotDays,
      serving: gapServingDays,
    },
  };

  console.log(JSON.stringify(report, null, 2));

  if (!strict) return;

  const rawOk = actualRaw !== null && actualRaw >= expected;
  const snapshotOk = actualSnapshot !== null && actualSnapshot >= expected;
  const servingOk = servingAsOf !== null && servingAsOf >= expected;
  if (rawOk && snapshotOk && servingOk) return;

  const missing = [
    rawOk ? null : "raw_snapshot_missing_or_stale",
    snapshotOk ? null : "fund_daily_snapshot_missing_or_stale",
    servingOk ? null : "serving_snapshot_missing_or_stale",
  ].filter((v): v is string => Boolean(v));
  console.error(`[freshness-target] strict check failed: ${missing.join(",")}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

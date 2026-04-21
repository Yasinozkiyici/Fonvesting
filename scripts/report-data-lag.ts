/**
 * CI/ops lag raporu:
 * - Otorite: /api/health?mode=full canonical freshness truth
 * - DB erişimi: yalnız opsiyonel best-effort probe (default kapalı)
 *   (workflow continuity için rapor üretimi DB-hard-fail yapmaz)
 */
import "./load-env";

type NullableDateInput = Date | string | null | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function toIsoOrNull(value: unknown): string | null {
  const normalized = normalizeDate(value);
  return normalized ? normalized.toISOString() : null;
}

function toDateKey(value: unknown): string | null {
  const iso = toIsoOrNull(value);
  return iso ? iso.slice(0, 10) : null;
}

function lagDaysDateKey(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
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

async function readHealthLagTruth() {
  const baseUrl = resolveBaseUrl();
  const response = await fetch(`${baseUrl}/api/health?mode=full`, {
    headers: { "x-health-secret": String(process.env.HEALTH_SECRET ?? "") },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`health_fetch_failed status=${response.status}`);
  const payloadUnknown = await response.json();
  if (!isRecord(payloadUnknown)) {
    throw new Error("health_payload_invalid_shape");
  }
  const payload = payloadUnknown;
  const freshness = isRecord(payload.freshness) ? payload.freshness : null;
  const truthCandidate = isRecord(payload.freshnessTruth)
    ? payload.freshnessTruth
    : freshness && isRecord(freshness.canonicalTruth)
      ? freshness.canonicalTruth
      : {};
  const truth = isRecord(truthCandidate) ? truthCandidate : {};
  const latestRaw = toDateKey(truth?.rawSnapshotAsOf ?? null);
  const latestSnapshot = toDateKey(truth?.snapshotAsOf ?? freshness?.latestFundSnapshotDate ?? null);
  const latestServing = toDateKey(truth?.servingSnapshotAsOf ?? null);
  return {
    generatedAt: new Date().toISOString(),
    proofSource: "health_truth",
    healthBaseUrl: baseUrl,
    healthStatus: String(payload?.status ?? "unknown"),
    rawPrices: {
      latestEffectiveDate: latestRaw,
      latestFetchedAt: null,
    },
    fundPriceHistory: { latestDate: null },
    fundDailySnapshot: { latestDate: latestSnapshot },
    serving: {
      latestSnapshotAsOf: latestServing,
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
      snapshotToServing: lagDaysDateKey(latestSnapshot, latestServing),
    },
    latestSyncLog: {
      syncType: "daily_sync",
      status: isRecord(payload.jobs) && isRecord(payload.jobs.dailySync) ? (payload.jobs.dailySync.status ?? null) : null,
      startedAt:
        isRecord(payload.jobs) && isRecord(payload.jobs.dailySync) ? toIsoOrNull(payload.jobs.dailySync.startedAt ?? null) : null,
      completedAt:
        isRecord(payload.jobs) && isRecord(payload.jobs.dailySync) ? toIsoOrNull(payload.jobs.dailySync.completedAt ?? null) : null,
      errorMessage:
        isRecord(payload.jobs) && isRecord(payload.jobs.dailySync) ? (payload.jobs.dailySync.errorMessage ?? null) : null,
    },
    truthSignals: {
      freshnessStatus: truth?.freshnessStatus ?? null,
      degradedReason: truth?.degradedReason ?? null,
      latestSuccessfulSyncAt: toIsoOrNull(truth?.latestSuccessfulSyncAt ?? freshness?.lastSuccessfulIngestionAt ?? null),
    },
  };
}

async function readOptionalDbProbe() {
  try {
    const module = await import("../src/lib/data-platform/serving-head");
    const heads = await Promise.race([
      module.readLatestServingHeadsMeta(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("db_probe_timeout")), 2_000)),
    ]);
    return {
      ok: true,
      message: null,
      heads: {
        fundList: toIsoOrNull(heads?.fundList?.snapshotAsOf ?? null),
        fundDetail: toIsoOrNull(heads?.fundDetail?.snapshotAsOf ?? null),
        compare: toIsoOrNull(heads?.compare?.snapshotAsOf ?? null),
        discovery: toIsoOrNull(heads?.discovery?.snapshotAsOf ?? null),
        system: toIsoOrNull(heads?.system?.snapshotAsOf ?? null),
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      heads: null,
    };
  }
}

async function main() {
  const out = await readHealthLagTruth();
  const enableOptionalDbProbe = String(process.env.REPORT_DATA_LAG_ENABLE_DB_PROBE ?? "").trim() === "1";
  const optionalDbProbe = enableOptionalDbProbe
    ? await readOptionalDbProbe()
    : {
        ok: false,
        message: "disabled_by_default",
        heads: null,
      };
  console.log(
    JSON.stringify(
      {
        ...out,
        optionalDbProbe,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

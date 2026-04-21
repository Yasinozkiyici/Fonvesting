/**
 * Phase A integrity kanıtı (DB-hard-dependency yok):
 * - Otorite: /api/health?mode=full (freshness truth + jobs truth)
 * - DB erişimi: yalnız best-effort telemetri, gate kararını bloke etmez
 */
import "./load-env";

type NullableDateInput = Date | string | null | undefined;

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

function toIsoOrNull(value: NullableDateInput): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  const ms = parsed.getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function toDateKey(value: NullableDateInput): string | null {
  const iso = toIsoOrNull(value);
  return iso ? iso.slice(0, 10) : null;
}

function maxDateKey(values: NullableDateInput[]): string | null {
  const keys = values.map((value) => toDateKey(value)).filter((value): value is string => Boolean(value)).sort();
  return keys.length > 0 ? keys[keys.length - 1] : null;
}

async function readHealthTruth() {
  const baseUrl = resolveBaseUrl();
  const response = await fetch(`${baseUrl}/api/health?mode=full`, {
    headers: { "x-health-secret": String(process.env.HEALTH_SECRET ?? "") },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`health_fetch_failed status=${response.status}`);
  }
  const payload = await response.json();
  const freshnessTruth = payload?.freshnessTruth ?? payload?.freshness?.canonicalTruth ?? {};
  return {
    baseUrl,
    payload,
    freshnessTruth,
  };
}

async function readOptionalDbProbe(): Promise<{
  ok: boolean;
  message: string | null;
  fundListBuildId: string | null;
  systemBuildId: string | null;
}> {
  try {
    const module = await import("../src/lib/data-platform/serving-head");
    const heads = await Promise.race([
      module.readLatestServingHeadsMeta(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("db_probe_timeout")), 2_000);
      }),
    ]);
    return {
      ok: true,
      message: null,
      fundListBuildId: heads?.fundList?.buildId ?? null,
      systemBuildId: heads?.system?.buildId ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      fundListBuildId: null,
      systemBuildId: null,
    };
  }
}

async function main() {
  const gate = process.argv.includes("--gate");
  const { baseUrl, payload, freshnessTruth } = await readHealthTruth();

  const healthStatus = String(payload?.status ?? "unknown");
  const jobDailySyncStatus = payload?.jobs?.dailySyncStatus ?? null;
  const jobDailySync = payload?.jobs?.dailySync ?? null;

  const latestRaw = toIsoOrNull(freshnessTruth?.rawSnapshotAsOf ?? null);
  const latestSnapshot =
    toIsoOrNull(freshnessTruth?.fundSnapshotAsOf ?? null) ??
    toIsoOrNull(payload?.freshness?.latestFundSnapshotDate ?? null);
  const latestServing = toIsoOrNull(freshnessTruth?.servingSnapshotAsOf ?? null);
  const latestSuccessfulSyncAt = toIsoOrNull(payload?.freshness?.lastSuccessfulIngestionAt ?? null);
  const latestPublishedSnapshotAt = toIsoOrNull(payload?.freshness?.lastPublishedSnapshotAt ?? null);
  const processedSnapshotDate = toIsoOrNull(jobDailySyncStatus?.processedSnapshotDate ?? null);

  const latestKnownDate = maxDateKey([
    latestRaw,
    latestSnapshot,
    latestServing,
    latestSuccessfulSyncAt,
    latestPublishedSnapshotAt,
    processedSnapshotDate,
  ]);
  const hasSnapshotCandidate = Boolean(latestSnapshot || latestServing || processedSnapshotDate || latestPublishedSnapshotAt);
  const hasDetectableLatestDate = Boolean(latestKnownDate);

  const snapshotConsistency =
    toDateKey(latestSnapshot) && toDateKey(payload?.freshness?.latestFundSnapshotDate)
      ? toDateKey(latestSnapshot) === toDateKey(payload?.freshness?.latestFundSnapshotDate)
      : null;
  const systemLatestKnownDate = toDateKey(payload?.freshness?.latestFundSnapshotDate ?? null);
  const systemKnownDateConsistent =
    latestKnownDate && systemLatestKnownDate ? latestKnownDate >= systemLatestKnownDate : null;

  const optionalDbProbe = await readOptionalDbProbe();
  const evidence = {
    generatedAt: new Date().toISOString(),
    gateMode: gate,
    proofSource: "health_truth",
    healthBaseUrl: baseUrl,
    healthStatus,
    pipelineIntegrity: {
      snapshotCandidateProduced: hasSnapshotCandidate,
      detectableLatestDataDate: hasDetectableLatestDate,
      latestKnownDate,
      systemKnownDateConsistent,
      snapshotConsistencyWithHealthFreshness: snapshotConsistency,
      silentFailureDetected: !hasSnapshotCandidate || !hasDetectableLatestDate,
    },
    truthSignals: {
      latestRawSnapshotAsOf: latestRaw,
      latestFundSnapshotDate: latestSnapshot,
      latestServingSnapshotAsOf: latestServing,
      latestSuccessfulSyncAt,
      latestPublishedSnapshotAt,
      dailySyncProcessedSnapshotDate: processedSnapshotDate,
      dailySyncOutcome: jobDailySyncStatus?.outcome ?? null,
      dailySyncSourceStatus: jobDailySyncStatus?.sourceStatus ?? null,
      dailySyncPublishStatus: jobDailySyncStatus?.publishStatus ?? null,
      dailySyncCompletedAt: toIsoOrNull(jobDailySync?.completedAt ?? null),
    },
    optionalDbProbe,
  };

  console.log(JSON.stringify(evidence, null, 2));

  if (!gate) return;

  if (!hasSnapshotCandidate) {
    console.error("[phase-a-gate] FAIL no_snapshot_candidate_detected_from_authoritative_health_truth");
    process.exit(1);
  }
  if (!hasDetectableLatestDate) {
    console.error("[phase-a-gate] FAIL no_detectable_latest_date_from_authoritative_health_truth");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

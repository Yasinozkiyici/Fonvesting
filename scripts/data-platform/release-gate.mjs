import { config } from "dotenv";
import path from "node:path";
import { withSmokeAuthFetchOptions } from "../smoke-auth.mjs";

config({ path: path.join(process.cwd(), ".env.local"), quiet: true });
config({ path: path.join(process.cwd(), ".env"), quiet: true });

function trimUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
}

const dataGateBase = trimUrl(process.env.DATA_RELEASE_GATE_BASE_URL);
const smokeBase = trimUrl(process.env.SMOKE_BASE_URL);
const previewBase = trimUrl(process.env.RELEASE_PREVIEW_URL);
const publicBase = trimUrl(process.env.NEXT_PUBLIC_BASE_URL);
const vercelRaw = trimUrl(process.env.VERCEL_URL);
const vercelHttps = vercelRaw ? (vercelRaw.startsWith("http") ? vercelRaw : `https://${vercelRaw}`) : "";

if (smokeBase && previewBase && smokeBase !== previewBase) {
  console.error(
    "[data-release-gate] conflicting target URLs: SMOKE_BASE_URL and RELEASE_PREVIEW_URL differ. Unify or set DATA_RELEASE_GATE_BASE_URL to the intended target."
  );
  process.exit(1);
}
if (dataGateBase && smokeBase && dataGateBase !== smokeBase) {
  console.error(
    "[data-release-gate] conflicting target URLs: DATA_RELEASE_GATE_BASE_URL differs from SMOKE_BASE_URL. Remove one or align values."
  );
  process.exit(1);
}
if (dataGateBase && previewBase && dataGateBase !== previewBase) {
  console.error(
    "[data-release-gate] conflicting target URLs: DATA_RELEASE_GATE_BASE_URL differs from RELEASE_PREVIEW_URL. Remove one or align values."
  );
  process.exit(1);
}

const baseUrl = dataGateBase || smokeBase || previewBase || publicBase || vercelHttps;
const timeoutMs = Number(process.env.DATA_GATE_TIMEOUT_MS || 30_000);
const strictHeaderEnabled = process.env.DATA_GATE_STRICT_MODE !== "0";
const publishLagHoursBudget = Number(process.env.DATA_GATE_PUBLISH_LAG_HOURS || 30);
const requireTargetEnv = process.env.DATA_GATE_REQUIRE_TARGET !== "0";
const expectedTargetEnv = String(process.env.DATA_GATE_EXPECTED_ENV || "").trim().toLowerCase();

if (!baseUrl) {
  console.error(
    "[data-release-gate] missing base URL. Set one of: DATA_RELEASE_GATE_BASE_URL (preferred), SMOKE_BASE_URL, RELEASE_PREVIEW_URL, NEXT_PUBLIC_BASE_URL, or VERCEL_URL (https:// prefix added automatically)"
  );
  process.exit(1);
}

const baseUrlSource = dataGateBase
  ? "DATA_RELEASE_GATE_BASE_URL"
  : smokeBase
    ? "SMOKE_BASE_URL"
    : previewBase
      ? "RELEASE_PREVIEW_URL"
      : publicBase
        ? "NEXT_PUBLIC_BASE_URL"
        : vercelHttps
          ? "VERCEL_URL"
          : "none";

function toDate(value) {
  if (!value || typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hoursSince(value) {
  const at = toDate(value);
  if (!at) return null;
  return (Date.now() - at.getTime()) / 3_600_000;
}

function parseDailyRunTruth(healthRootPayload) {
  const dailySync = healthRootPayload?.jobs?.dailySync ?? null;
  const dailySyncStatus = healthRootPayload?.jobs?.dailySyncStatus ?? null;
  const completedAt = dailySync?.completedAt ?? null;
  const publishedAt = healthRootPayload?.freshness?.lastPublishedSnapshotAt ?? null;
  const latestSnapshotDate = healthRootPayload?.freshness?.latestFundSnapshotDate ?? null;
  const sourceStatus = dailySyncStatus?.sourceStatus ?? "unknown";
  const publishStatus = dailySyncStatus?.publishStatus ?? "unknown";
  const outcome =
    dailySyncStatus?.outcome ??
    (dailySync?.status === "SUCCESS"
      ? "success"
      : dailySync?.status === "TIMEOUT"
        ? "timeout_suspected"
        : dailySync?.status === "FAILED"
          ? "failed"
          : "unknown");
  const sourceQuality = dailySyncStatus?.sourceQuality ?? "unknown";
  const publishBuildId = dailySyncStatus?.publishBuildId ?? null;
  const processedSnapshotDate = dailySyncStatus?.processedSnapshotDate ?? latestSnapshotDate ?? null;
  return {
    completedAt,
    publishedAt,
    latestSnapshotDate,
    sourceStatus,
    publishStatus,
    outcome,
    sourceQuality,
    publishBuildId,
    processedSnapshotDate,
    staleRunRecovered: dailySyncStatus?.staleRunRecovered ?? false,
    missedSlaToday: Boolean(dailySyncStatus?.missedSlaToday),
    runStatus: dailySync?.status ?? "unknown",
    hasParsedMeta: true,
  };
}

async function fetchJson(path) {
  const headers = {
    "x-health-secret": process.env.HEALTH_SECRET || "",
  };
  if (strictHeaderEnabled) {
    headers["x-serving-strict"] = "1";
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...withSmokeAuthFetchOptions({
      signal: AbortSignal.timeout(timeoutMs),
      headers,
    }),
  });
  const body = await response.text();
  let payload = null;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
    throw new Error(`${path} invalid_json status=${response.status}`);
  }
  const observed = {
    strictMode: response.headers.get("x-serving-strict-mode") ?? "0",
    strictViolation: response.headers.get("x-serving-strict-violation") ?? "0",
    strictReason: response.headers.get("x-serving-strict-reason") ?? "none",
    fallbackUsed: response.headers.get("x-serving-fallback-used") ?? response.headers.get("x-market-fallback-used") ?? "0",
    trustFinal:
      response.headers.get("x-serving-trust-final") ??
      response.headers.get("x-compare-trust-final") ??
      response.headers.get("x-compare-series-trust-final") ??
      response.headers.get("x-discovery-trust-final") ??
      "0",
    degradedKind:
      response.headers.get("x-serving-degraded-kind") ??
      response.headers.get("x-scores-degraded") ??
      response.headers.get("x-compare-degraded-source") ??
      response.headers.get("x-compare-series-degraded-source") ??
      response.headers.get("x-market-degraded") ??
      "none",
    routeSource:
      response.headers.get("x-serving-route-source") ??
      response.headers.get("x-scores-source") ??
      response.headers.get("x-market-cache") ??
      "unknown",
    worldId: response.headers.get("x-serving-world-id") ?? "none",
    worldAligned: response.headers.get("x-serving-world-aligned") ?? "0",
    buildIds: {
      fundList: response.headers.get("x-serving-fundlist-build-id") ?? "none",
      discovery: response.headers.get("x-serving-discovery-build-id") ?? "none",
      compare: response.headers.get("x-serving-compare-build-id") ?? "none",
      system: response.headers.get("x-serving-system-build-id") ?? "none",
    },
  };
  return { response, payload, observed };
}

function pushCheck(rows, id, pass, message, evidence = {}) {
  rows.push({ id, pass, message, evidence });
}

const checks = [];
const blockers = [];

try {
  const [healthRoot, healthData, healthServing, fundsList, scores, compare, compareSeries, market] = await Promise.all([
    fetchJson("/api/health?mode=full"),
    fetchJson("/api/health/data"),
    fetchJson("/api/health/serving"),
    fetchJson("/api/funds?page=1&pageSize=10"),
    fetchJson("/api/funds/scores?mode=BEST&limit=120"),
    fetchJson("/api/funds/compare?codes=VGA,TI1"),
    fetchJson("/api/funds/compare-series?base=VGA&codes=TI1"),
    fetchJson("/api/market"),
  ]);

  pushCheck(
    checks,
    "health-root-http",
    healthRoot.response.ok,
    "Root health endpoint must respond with success.",
    { status: healthRoot.response.status }
  );
  if (requireTargetEnv) {
    pushCheck(
      checks,
      "target-environment-resolved",
      Boolean(baseUrl),
      "Release gate must run against an explicit target URL.",
      { baseUrl, expectedTargetEnv: expectedTargetEnv || null }
    );
  }
  if (expectedTargetEnv) {
    const actualEnv = String(healthRoot.payload?.build?.env ?? "").trim().toLowerCase();
    pushCheck(
      checks,
      "target-environment-match",
      Boolean(actualEnv) && actualEnv === expectedTargetEnv,
      "Target environment must match expected release environment.",
      { actualEnv: actualEnv || null, expectedTargetEnv }
    );
  }
  pushCheck(
    checks,
    "health-root-semantic",
    healthRoot.payload?.database?.diagnostics?.readPathOperational === true,
    "Root health must report read path operational.",
    { readPathOperational: healthRoot.payload?.database?.diagnostics?.readPathOperational ?? null }
  );

  const dailyTruth = parseDailyRunTruth(healthRoot.payload);
  const freshnessTruth = healthRoot.payload?.freshnessTruth ?? healthRoot.payload?.freshness?.canonicalTruth ?? null;
  const chartSnapshotAsOf = freshnessTruth?.chartSnapshotAsOf ?? null;
  const comparisonSnapshotAsOf = freshnessTruth?.comparisonSnapshotAsOf ?? null;
  const servingSnapshotAsOf = freshnessTruth?.servingSnapshotAsOf ?? null;
  const freshnessStatus = freshnessTruth?.freshnessStatus ?? "unknown";
  const freshnessDegradedReason = freshnessTruth?.degradedReason ?? "unknown";
  const dailyCompletedHours = hoursSince(dailyTruth.completedAt);
  const publishedHours = hoursSince(dailyTruth.publishedAt);
  const chartPublishedHours = hoursSince(chartSnapshotAsOf);
  const comparisonPublishedHours = hoursSince(comparisonSnapshotAsOf);
  const dailyNotCompletedToday =
    dailyTruth.missedSlaToday || !dailyTruth.completedAt || (dailyCompletedHours != null && dailyCompletedHours > 36);
  const publishLag = publishedHours == null || publishedHours > publishLagHoursBudget;
  const publishFailed = dailyTruth.publishStatus !== "success";
  const sourceQualityAnomaly =
    dailyTruth.sourceQuality === "empty_source_anomaly" || dailyTruth.sourceQuality === "partial_source_failure";
  const outcomeNotStrictSuccess =
    dailyTruth.outcome !== "success" ||
    dailyTruth.sourceStatus !== "success" ||
    dailyTruth.publishStatus !== "success" ||
    dailyTruth.runStatus !== "SUCCESS";
  const chartLag = chartPublishedHours == null || chartPublishedHours > publishLagHoursBudget;
  const comparisonLag = comparisonPublishedHours == null || comparisonPublishedHours > publishLagHoursBudget;

  const dailyChecks = [
    {
      id: "daily_sync_not_completed_today",
      pass: !dailyNotCompletedToday,
      message: "Latest daily_sync must be completed within expected window.",
      reason: "daily_sync_not_completed_today",
    },
    {
      id: "daily_sync_publish_lag",
      pass: !publishLag,
      message: "Last published snapshot must stay within publish lag budget.",
      reason: "daily_sync_publish_lag",
    },
    {
      id: "daily_sync_publish_failed",
      pass: !publishFailed,
      message: "Daily publish status must be success for release.",
      reason: "daily_sync_publish_failed",
    },
    {
      id: "daily_sync_source_quality",
      pass: !sourceQualityAnomaly,
      message: "Daily source quality anomaly must block release.",
      reason: `daily_sync_source_quality:${dailyTruth.sourceQuality}`,
    },
    {
      id: "daily_sync_outcome_strict_success",
      pass: !outcomeNotStrictSuccess,
      message: "Daily outcome/source/publish contract must be strict success.",
      reason: `daily_sync_outcome:${dailyTruth.outcome}`,
    },
    {
      id: "freshness_truth_status",
      pass: freshnessStatus === "fresh" || freshnessStatus === "stale_ok",
      message: "Freshness truth status must not be degraded_outdated.",
      reason: `freshness_truth_status:${freshnessStatus}`,
    },
    {
      id: "serving_snapshot_published",
      pass: Boolean(servingSnapshotAsOf),
      message: "Serving publish snapshot date must be present in canonical freshness truth.",
      reason: "serving_snapshot_missing",
    },
    {
      id: "chart_publish_lag",
      pass: !chartLag,
      message: "Chart publish snapshot must stay within publish lag budget.",
      reason: "chart_publish_lag",
    },
    {
      id: "comparison_publish_lag",
      pass: !comparisonLag,
      message: "Comparison publish snapshot must stay within publish lag budget.",
      reason: "comparison_publish_lag",
    },
  ];
  for (const item of dailyChecks) {
    pushCheck(checks, item.id, item.pass, item.message, {
      lastRunTimestamp: dailyTruth.completedAt,
      processedSnapshotDate: dailyTruth.processedSnapshotDate,
      outcome: dailyTruth.outcome,
      sourceStatus: dailyTruth.sourceStatus,
      publishStatus: dailyTruth.publishStatus,
      sourceQuality: dailyTruth.sourceQuality,
      publishBuildId: dailyTruth.publishBuildId,
      publishLagHours: publishedHours,
      chartSnapshotAsOf,
      comparisonSnapshotAsOf,
      servingSnapshotAsOf,
      chartPublishedHours,
      comparisonPublishedHours,
      freshnessStatus,
      freshnessDegradedReason,
      runStatus: dailyTruth.runStatus,
      missedSlaToday: dailyTruth.missedSlaToday,
      hasParsedMeta: dailyTruth.hasParsedMeta,
    });
    if (!item.pass) blockers.push(item.reason);
  }
  pushCheck(
    checks,
    "daily_sync_latest_run_authoritative",
    Boolean(dailyTruth.completedAt || dailyTruth.runStatus !== "unknown"),
    "Latest daily_sync row must be present; old incomplete rows are not treated as healthy.",
    {
      hasParsedMeta: dailyTruth.hasParsedMeta,
      runStatus: dailyTruth.runStatus,
      lastRunTimestamp: dailyTruth.completedAt,
    }
  );
  pushCheck(
    checks,
    "health-data-freshness",
    typeof healthData.payload?.freshnessAssessment?.staleDays === "number" &&
      healthData.payload.freshnessAssessment.staleDays <= 2,
    "Data health stale days should stay within 2 days.",
    { staleDays: healthData.payload?.freshnessAssessment?.staleDays ?? null }
  );
  pushCheck(
    checks,
    "health-serving-alignment",
    healthServing.payload?.quality?.buildAligned === true && healthServing.payload?.quality?.detailAligned === true,
    "Serving health must report aligned build IDs.",
    { quality: healthServing.payload?.quality ?? null }
  );
  pushCheck(
    checks,
    "serving-rows-non-empty",
    Number(healthServing.payload?.rowCounts?.list ?? 0) > 0 &&
      Number(healthServing.payload?.rowCounts?.detail ?? 0) > 0 &&
      Number(healthServing.payload?.rowCounts?.compare ?? 0) > 0,
    "Serving row counts must be non-empty for list/detail/compare.",
    { rowCounts: healthServing.payload?.rowCounts ?? null }
  );
  pushCheck(
    checks,
    "list-route-contract",
    fundsList.response.ok && Array.isArray(fundsList.payload?.items) && fundsList.payload.items.length > 0,
    "Funds list route should return non-empty items.",
    {
      status: fundsList.response.status,
      count: Array.isArray(fundsList.payload?.items) ? fundsList.payload.items.length : 0,
      observed: fundsList.observed,
    }
  );
  pushCheck(
    checks,
    "scores-route-contract",
    scores.response.ok && Array.isArray(scores.payload?.funds) && scores.payload.funds.length > 0,
    "Scores route should return non-empty serving-backed funds.",
    {
      status: scores.response.status,
      count: Array.isArray(scores.payload?.funds) ? scores.payload.funds.length : 0,
      observed: scores.observed,
    }
  );
  pushCheck(
    checks,
    "compare-route-contract",
    compare.response.ok && Array.isArray(compare.payload?.funds) && compare.payload.funds.length >= 2,
    "Compare route should return at least two funds.",
    {
      status: compare.response.status,
      count: Array.isArray(compare.payload?.funds) ? compare.payload.funds.length : 0,
      observed: compare.observed,
    }
  );
  pushCheck(
    checks,
    "compare-series-route-contract",
    compareSeries.response.ok &&
    Array.isArray(compareSeries.payload?.fundSeries) &&
      compareSeries.payload.fundSeries.some(
        (item) => item?.code === "VGA" && Array.isArray(item.series) && item.series.length > 0
      ) &&
      compareSeries.payload.fundSeries.some(
        (item) => item?.code === "TI1" && Array.isArray(item.series) && item.series.length > 0
      ),
    "Compare-series route should return valid series for base and companion.",
    {
      status: compareSeries.response.status,
      fundSeriesCount: Array.isArray(compareSeries.payload?.fundSeries) ? compareSeries.payload.fundSeries.length : 0,
      observed: compareSeries.observed,
    }
  );
  pushCheck(
    checks,
    "market-route-contract",
    market.response.ok && typeof market.payload?.fundCount === "number" && market.payload.fundCount > 0,
    "Market route should return serving-backed non-empty aggregate.",
    {
      status: market.response.status,
      fundCount: market.payload?.fundCount ?? null,
      observed: market.observed,
    }
  );

  const strictCriticalRoutes = [
    { id: "strict-funds", result: fundsList },
    { id: "strict-scores", result: scores },
    { id: "strict-compare", result: compare },
    { id: "strict-compare-series", result: compareSeries },
    { id: "strict-market", result: market },
  ];
  for (const route of strictCriticalRoutes) {
    const observed = route.result.observed;
    const pass =
      route.result.response.ok &&
      observed.strictMode === "1" &&
      observed.strictViolation !== "1" &&
      observed.fallbackUsed !== "1" &&
      observed.trustFinal === "1" &&
      observed.worldId !== "none" &&
      observed.worldAligned === "1" &&
      observed.buildIds.fundList !== "none" &&
      observed.buildIds.compare !== "none" &&
      observed.buildIds.system !== "none";
    pushCheck(
      checks,
      route.id,
      pass,
      `${route.id} must pass strict serving cutover without fallback/degraded behavior.`,
      {
        status: route.result.response.status,
        observed,
      }
    );
  }

  const observedWorldIds = [fundsList, scores, compare, compareSeries, market]
    .map((item) => item.observed.worldId)
    .filter((value) => value && value !== "none");
  const singleWorld = new Set(observedWorldIds).size <= 1;
  pushCheck(
    checks,
    "strict-world-id-alignment",
    observedWorldIds.length > 0 && singleWorld,
    "Critical routes should observe a single serving world id in strict mode.",
    { observedWorldIds }
  );
  const observedBuildTriples = [fundsList, scores, compare, compareSeries, market].map((item) => ({
    fundList: item.observed.buildIds.fundList,
    compare: item.observed.buildIds.compare,
    system: item.observed.buildIds.system,
  }));
  const buildTriplesAligned = observedBuildTriples.every(
    (triple) =>
      triple.fundList !== "none" &&
      triple.compare !== "none" &&
      triple.system !== "none" &&
      triple.fundList === triple.compare &&
      triple.compare === triple.system
  );
  pushCheck(
    checks,
    "strict-build-id-alignment",
    buildTriplesAligned,
    "Critical routes should expose aligned serving build ids.",
    { observedBuildTriples }
  );
} catch (error) {
  console.error("[data-release-gate] fatal", error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log("\n=== Data Release Gate ===");
console.log(`[data-release-gate] target=${baseUrl} (from ${baseUrlSource})`);
for (const check of checks) {
  console.log(`[${check.pass ? "PASS" : "FAIL"}] ${check.id} ${check.message}`);
}

const failed = checks.filter((check) => !check.pass);
const gateOk = failed.length === 0;
console.log(
  JSON.stringify(
    {
      ok: gateOk,
      total: checks.length,
      failed: failed.map((item) => ({ id: item.id, message: item.message, evidence: item.evidence })),
      blockerReasons: [...new Set(blockers)],
      baseUrl,
      baseUrlSource,
      strictHeaderEnabled,
      generatedAt: new Date().toISOString(),
    },
    null,
    2
  )
);

console.error(`[data-release-gate] GATE_OK=${gateOk ? "1" : "0"} EXIT=${gateOk ? "0" : "1"}`);
if (!gateOk) process.exit(1);

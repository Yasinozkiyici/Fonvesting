import "../load-env";
import { prisma } from "../../src/lib/prisma";
import { readLatestServingHeads } from "../../src/lib/data-platform/serving-head";
import { readUiServingWorldMeta } from "../../src/lib/domain/serving/ui-cutover-contract";
import { getSystemHealthSnapshot } from "../../src/lib/system-health";
import { evaluateServingUniverseIntegrity } from "../../src/lib/data-platform/serving-integrity";

type CheckSeverity = "critical" | "warning";
type CheckStatus = "pass" | "fail" | "warn";

type VerificationCheck = {
  id: string;
  layer: "raw" | "canonical" | "serving" | "health" | "prodlike";
  severity: CheckSeverity;
  status: CheckStatus;
  message: string;
  evidence?: Record<string, unknown>;
};

function createCheck(
  id: VerificationCheck["id"],
  layer: VerificationCheck["layer"],
  severity: VerificationCheck["severity"],
  pass: boolean,
  message: string,
  evidence?: Record<string, unknown>,
  warnOnly?: boolean
): VerificationCheck {
  if (pass) return { id, layer, severity, status: "pass", message, evidence };
  if (warnOnly) return { id, layer, severity, status: "warn", message, evidence };
  return { id, layer, severity, status: "fail", message, evidence };
}

function daysSince(value: Date | null | undefined): number | null {
  if (!value) return null;
  return Math.floor((Date.now() - value.getTime()) / 86_400_000);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseSeriesPoints(payload: unknown): { malformed: boolean; reason?: string } {
  const root = asObject(payload);
  if (!root) return { malformed: true, reason: "payload_not_object" };
  const chartSeries = root.chartSeries;
  if (chartSeries == null) return { malformed: false };
  if (!Array.isArray(chartSeries)) return { malformed: true, reason: "chart_series_not_array" };
  for (const [index, point] of chartSeries.entries()) {
    const row = asObject(point);
    if (!row) return { malformed: true, reason: `chart_point_${index}_not_object` };
    const date = row.date;
    const value = row.value;
    if (typeof date !== "string" || !date.trim()) {
      return { malformed: true, reason: `chart_point_${index}_invalid_date` };
    }
    if (!isFiniteNumber(value) || value <= 0) {
      return { malformed: true, reason: `chart_point_${index}_invalid_value` };
    }
  }
  return { malformed: false };
}

async function main() {
  /** İki dalga: tek seferde 14 paralel sorgu düşük connection_limit (ör. Supabase 5) ile P2024 üretebiliyor. */
  const [fundCount, activeFundCount, latestHistory, latestSnapshot, latestMarket, latestMacro] = await Promise.all([
    prisma.fund.count(),
    prisma.fund.count({ where: { isActive: true } }),
    prisma.fundPriceHistory.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
    prisma.fundDailySnapshot.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
    prisma.marketSnapshot.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
    prisma.macroObservation.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
  ]);
  const [
    rawPricesCount,
    servingListCount,
    servingDetailCount,
    servingCompareCount,
    servingDiscoveryCount,
    servingSystemCount,
    parseFailedRawCount,
    failedRawSources,
  ] = await Promise.all([
    prisma.rawPricesPayload.count().catch(() => -1),
    prisma.servingFundList.count().catch(() => -1),
    prisma.servingFundDetail.count().catch(() => -1),
    prisma.servingCompareInputs.count().catch(() => -1),
    prisma.servingDiscoveryIndex.count().catch(() => -1),
    prisma.servingSystemStatus.count().catch(() => -1),
    prisma.rawPricesPayload.count({ where: { parseStatus: "FAILED" } }).catch(() => -1),
    prisma.rawPricesPayload.groupBy({ by: ["sourceKey"], where: { parseStatus: "FAILED" } }).then((rows) => rows.length).catch(() => -1),
  ]);

  const [heads, worldMeta, systemHealth] = await Promise.all([
    readLatestServingHeads().catch(() => null),
    readUiServingWorldMeta().catch(() => null),
    getSystemHealthSnapshot({ lightweight: false, includeExternalProbes: false }).catch(() => null),
  ]);

  const alignedBuildId = Boolean(
    heads?.fundList?.buildId &&
      heads?.fundDetail?.buildId &&
      heads?.compare?.buildId &&
      heads?.discovery?.buildId &&
      heads?.system?.buildId &&
      heads.fundList.buildId === heads.fundDetail.buildId &&
      heads.fundList.buildId === heads.compare.buildId &&
      heads.compare.buildId === heads.discovery.buildId &&
      heads.discovery.buildId === heads.system.buildId
  );

  const detailBuildDistinctCount = heads?.fundList?.buildId
    ? await prisma.servingFundDetail
        .findMany({
          where: { buildId: heads.fundList.buildId },
          select: { buildId: true },
          distinct: ["buildId"],
          take: 2,
        })
        .then((rows) => rows.length)
        .catch(() => -1)
    : -1;

  const latestSnapshotDate = latestSnapshot?.date ?? null;
  const latestSnapshotRows = latestSnapshotDate
    ? await prisma.fundDailySnapshot
        .findMany({
          where: { date: latestSnapshotDate },
          select: {
            code: true,
            lastPrice: true,
            dailyReturn: true,
            monthlyReturn: true,
            yearlyReturn: true,
            portfolioSize: true,
            investorCount: true,
          },
        })
        .catch(() => [])
    : [];

  const missingCriticalMetrics = latestSnapshotRows.filter(
    (row) =>
      !row.code ||
      row.lastPrice <= 0 ||
      !isFiniteNumber(row.dailyReturn) ||
      !isFiniteNumber(row.monthlyReturn) ||
      !isFiniteNumber(row.yearlyReturn) ||
      !isFiniteNumber(row.portfolioSize) ||
      row.portfolioSize < 0 ||
      !Number.isInteger(row.investorCount) ||
      row.investorCount < 0
  ).length;

  const latestListPayload = heads?.fundList?.buildId
    ? await prisma.servingFundList
        .findFirst({
          where: { buildId: heads.fundList.buildId },
          orderBy: { updatedAt: "desc" },
          select: { payload: true, buildId: true },
        })
        .catch(() => null)
    : null;
  const latestComparePayload = heads?.fundList?.buildId
    ? await prisma.servingCompareInputs
        .findFirst({
          where: { buildId: heads.fundList.buildId },
          orderBy: { updatedAt: "desc" },
          select: { payload: true },
        })
        .catch(() => null)
    : null;
  const detailCodes = heads?.fundList?.buildId
    ? await prisma.servingFundDetail
        .findMany({
          where: { buildId: heads.fundList.buildId },
          select: { fundCode: true },
        })
        .catch(() => [])
    : [];
  const detailSamples = heads?.fundList?.buildId
    ? await prisma.servingFundDetail
        .findMany({
          where: { buildId: heads.fundList.buildId },
          select: { fundCode: true, payload: true },
          take: 150,
        })
        .catch(() => [])
    : [];

  const latestBuildId = heads?.fundList?.buildId ?? null;
  const latestBuildRows = latestBuildId
    ? await Promise.all([
        prisma.servingFundList.count({ where: { buildId: latestBuildId } }).catch(() => -1),
        prisma.servingCompareInputs.count({ where: { buildId: latestBuildId } }).catch(() => -1),
        prisma.servingDiscoveryIndex.count({ where: { buildId: latestBuildId } }).catch(() => -1),
        prisma.servingSystemStatus.count({ where: { buildId: latestBuildId } }).catch(() => -1),
        prisma.servingFundDetail.count({ where: { buildId: latestBuildId } }).catch(() => -1),
      ]).then(([list, compare, discovery, system, detail]) => ({ list, compare, discovery, system, detail }))
    : { list: -1, compare: -1, discovery: -1, system: -1, detail: -1 };

  const servingDistinctBuildCounts = await Promise.all([
    prisma.servingFundList.findMany({ select: { buildId: true }, distinct: ["buildId"] }).then((rows) => rows.length).catch(() => -1),
    prisma.servingFundDetail.findMany({ select: { buildId: true }, distinct: ["buildId"] }).then((rows) => rows.length).catch(() => -1),
    prisma.servingCompareInputs.findMany({ select: { buildId: true }, distinct: ["buildId"] }).then((rows) => rows.length).catch(() => -1),
    prisma.servingDiscoveryIndex.findMany({ select: { buildId: true }, distinct: ["buildId"] }).then((rows) => rows.length).catch(() => -1),
    prisma.servingSystemStatus.findMany({ select: { buildId: true }, distinct: ["buildId"] }).then((rows) => rows.length).catch(() => -1),
  ]).then(([list, detail, compare, discovery, system]) => ({ list, detail, compare, discovery, system }));

  const listFunds = asObject(latestListPayload?.payload)?.funds;
  const compareFunds = asObject(latestComparePayload?.payload)?.funds;
  const latestDiscoveryPayload = heads?.fundList?.buildId
    ? await prisma.servingDiscoveryIndex
        .findFirst({
          where: { buildId: heads.fundList.buildId },
          orderBy: { updatedAt: "desc" },
          select: { payload: true },
        })
        .catch(() => null)
    : null;
  const listCodes = new Set(
    Array.isArray(listFunds)
      ? listFunds.map((item) => String(asObject(item)?.code ?? "").trim().toUpperCase()).filter(Boolean)
      : []
  );
  const compareCodes = new Set(
    Array.isArray(compareFunds)
      ? compareFunds.map((item) => String(asObject(item)?.code ?? "").trim().toUpperCase()).filter(Boolean)
      : []
  );
  const detailCodeSet = new Set(detailCodes.map((item) => item.fundCode.trim().toUpperCase()).filter(Boolean));
  const compareMissingInList = [...compareCodes].filter((code) => !listCodes.has(code));
  const listMissingInDetail = [...listCodes].filter((code) => !detailCodeSet.has(code));

  let malformedChartSeriesCount = 0;
  const malformedChartReasons: Record<string, number> = {};
  for (const row of detailSamples) {
    const state = parseSeriesPoints(row.payload);
    if (state.malformed) {
      malformedChartSeriesCount += 1;
      const key = state.reason ?? "unknown";
      malformedChartReasons[key] = (malformedChartReasons[key] ?? 0) + 1;
    }
  }

  /** Full-table scan times out on large DBs; only the latest snapshot date is release-relevant. */
  const requiredFieldGaps =
    latestSnapshotDate != null
      ? await prisma.fundDailySnapshot
          .count({
            where: {
              date: latestSnapshotDate,
              OR: [{ code: "" }, { name: "" }, { lastPrice: { lte: 0 } }],
            },
          })
          .catch(() => -1)
      : -1;

  const rawFreshnessDays = daysSince(
    await prisma.rawPricesPayload
      .findFirst({ orderBy: { fetchedAt: "desc" }, select: { fetchedAt: true } })
      .then((r) => r?.fetchedAt ?? null)
      .catch(() => null)
  );
  const canonicalFreshnessDays = daysSince(latestSnapshotDate);
  const servingFreshnessDays = daysSince(heads?.system?.snapshotAsOf ?? null);
  const servingUniverse = evaluateServingUniverseIntegrity({
    activeFundCount,
    listPayload: latestListPayload?.payload ?? null,
    comparePayload: latestComparePayload?.payload ?? null,
    discoveryPayload: latestDiscoveryPayload?.payload ?? null,
    detailCountForBuild: detailCodeSet.size,
  });

  const checks: VerificationCheck[] = [
    createCheck(
      "raw-ingestion-non-empty",
      "raw",
      "critical",
      rawPricesCount > 0,
      "Raw price ingestion table should not be empty.",
      { rawPricesCount }
    ),
    createCheck(
      "raw-parse-failure-budget",
      "raw",
      "critical",
      rawPricesCount > 0 && parseFailedRawCount >= 0 && parseFailedRawCount / rawPricesCount <= 0.02,
      "Raw parse failure ratio must stay under 2%.",
      { parseFailedRawCount, rawPricesCount }
    ),
    createCheck(
      "raw-source-failure-budget",
      "raw",
      "warning",
      failedRawSources >= 0 && failedRawSources <= 2,
      "Distinct failed raw sources should remain limited.",
      { failedRawSources },
      true
    ),
    createCheck(
      "canonical-population",
      "canonical",
      "critical",
      latestSnapshotRows.length > 0 && activeFundCount > 0,
      "Canonical snapshot should include active funds.",
      { latestSnapshotRows: latestSnapshotRows.length, activeFundCount }
    ),
    createCheck(
      "canonical-critical-metrics",
      "canonical",
      "critical",
      missingCriticalMetrics === 0,
      "Canonical latest snapshot must not have missing/invalid critical metrics.",
      { missingCriticalMetrics, sampled: latestSnapshotRows.length }
    ),
    createCheck(
      "serving-row-population",
      "serving",
      "critical",
      servingListCount > 0 &&
        servingDetailCount > 0 &&
        servingCompareCount > 0 &&
        servingDiscoveryCount > 0 &&
        servingSystemCount > 0,
      "Serving tables should be populated across list/detail/compare/discovery/system.",
      { servingListCount, servingDetailCount, servingCompareCount, servingDiscoveryCount, servingSystemCount }
    ),
    createCheck(
      "serving-latest-build-envelope-shape",
      "serving",
      "critical",
      latestBuildRows.list === 1 &&
        latestBuildRows.compare === 1 &&
        latestBuildRows.discovery === 1 &&
        latestBuildRows.system === 1 &&
        latestBuildRows.detail > 0,
      "Latest serving build must have 1 envelope row for list/compare/discovery/system and non-empty detail rows.",
      { latestBuildId, latestBuildRows }
    ),
    createCheck(
      "serving-latest-build-universe-integrity",
      "serving",
      "critical",
      !servingUniverse.empty && !servingUniverse.sparse,
      "Latest serving build universe must not be empty or sparse.",
      servingUniverse
    ),
    createCheck(
      "serving-build-alignment",
      "serving",
      "critical",
      alignedBuildId && worldMeta?.worldAligned === true,
      "Serving buildId should align across list/detail/compare/discovery/system.",
      { alignedBuildId, worldAligned: worldMeta?.worldAligned ?? false, buildIds: worldMeta?.buildIds ?? null }
    ),
    createCheck(
      "serving-detail-build-integrity",
      "serving",
      "critical",
      detailBuildDistinctCount === 1,
      "Serving detail table must map to a single latest build.",
      { detailBuildDistinctCount, latestBuildId: heads?.fundList?.buildId ?? null }
    ),
    createCheck(
      "serving-contract-list-compare-detail",
      "serving",
      "critical",
      compareMissingInList.length === 0 && listMissingInDetail.length === 0,
      "List/compare/detail code sets must stay aligned.",
      {
        compareMissingInList: compareMissingInList.slice(0, 10),
        listMissingInDetail: listMissingInDetail.slice(0, 10),
        listCount: listCodes.size,
        compareCount: compareCodes.size,
        detailCount: detailCodeSet.size,
      }
    ),
    createCheck(
      "serving-chart-series-shape",
      "serving",
      "critical",
      malformedChartSeriesCount === 0,
      "Serving detail chart series should be parseable and positive-valued.",
      { malformedChartSeriesCount, malformedChartReasons, sampled: detailSamples.length }
    ),
    createCheck(
      "freshness-raw",
      "health",
      "warning",
      rawFreshnessDays != null && rawFreshnessDays <= 2,
      "Raw ingestion freshness should be <=2 days.",
      { rawFreshnessDays },
      true
    ),
    createCheck(
      "freshness-canonical",
      "health",
      "critical",
      canonicalFreshnessDays != null && canonicalFreshnessDays <= 2,
      "Canonical snapshot freshness should be <=2 days.",
      { canonicalFreshnessDays }
    ),
    createCheck(
      "freshness-serving",
      "health",
      "critical",
      servingFreshnessDays != null && servingFreshnessDays <= 2,
      "Serving snapshot freshness should be <=2 days.",
      { servingFreshnessDays }
    ),
    createCheck(
      "health-semantic-truthfulness",
      "health",
      "critical",
      Boolean(
        systemHealth &&
          systemHealth.database.diagnostics.readPathOperational &&
          (systemHealth.ok ? systemHealth.status === "ok" : true)
      ),
      "System health snapshot must be semantically consistent with readiness flags.",
      systemHealth
        ? {
            status: systemHealth.status,
            ok: systemHealth.ok,
            readPathOperational: systemHealth.database.diagnostics.readPathOperational,
            dailySyncStatus: systemHealth.jobs.dailySyncStatus,
          }
        : { systemHealth: null }
    ),
    createCheck(
      "daily-sync-status-known",
      "health",
      "critical",
      Boolean(
        systemHealth?.jobs.dailySyncStatus &&
          systemHealth.jobs.dailySyncStatus.sourceStatus !== "unknown" &&
          systemHealth.jobs.dailySyncStatus.publishStatus !== "unknown"
      ),
      "Daily sync source/publish status should be known after the latest run.",
      systemHealth?.jobs.dailySyncStatus ? { dailySyncStatus: systemHealth.jobs.dailySyncStatus } : { dailySyncStatus: null }
    ),
    createCheck(
      "daily-sync-missed-run-detection",
      "health",
      "critical",
      Boolean(systemHealth && !systemHealth.issues.some((issue) => issue.code === "daily_sync_not_completed_today")),
      "Daily pipeline must complete within expected SLA window.",
      systemHealth ? { dailySyncStatus: systemHealth.jobs.dailySyncStatus, issues: systemHealth.issues } : { systemHealth: null }
    ),
    createCheck(
      "daily-sync-publish-lag-detection",
      "health",
      "critical",
      Boolean(systemHealth && !systemHealth.issues.some((issue) => issue.code === "daily_sync_publish_lag")),
      "Publish success must not lag canonical/serving freshness.",
      systemHealth ? { freshness: systemHealth.freshness, dailySyncStatus: systemHealth.jobs.dailySyncStatus } : { systemHealth: null }
    ),
    createCheck(
      "daily-sync-empty-sparse-anomaly",
      "health",
      "critical",
      Boolean(
        systemHealth &&
          !systemHealth.issues.some((issue) =>
            ["daily_sync_empty_source_anomaly", "daily_sync_partial_source_failure"].includes(issue.code)
          )
      ),
      "Empty or partial source anomalies must be visible and block healthy verdict.",
      systemHealth ? { dailySyncStatus: systemHealth.jobs.dailySyncStatus, issues: systemHealth.issues } : { systemHealth: null }
    ),
    createCheck(
      "prodlike-parity-ready",
      "prodlike",
      "critical",
      Boolean(
        process.env.DATA_RELEASE_GATE_BASE_URL ||
          process.env.SMOKE_BASE_URL ||
          process.env.RELEASE_PREVIEW_URL ||
          process.env.RELEASE_PRODUCTION_URL ||
          process.env.NEXT_PUBLIC_BASE_URL ||
          process.env.VERCEL_URL
      ),
      "Prodlike / release-gate target URL should be configured (DATA_RELEASE_GATE_BASE_URL, SMOKE_BASE_URL, RELEASE_PREVIEW_URL, NEXT_PUBLIC_BASE_URL, or VERCEL_URL).",
      {
        dataReleaseGateBaseConfigured: Boolean(process.env.DATA_RELEASE_GATE_BASE_URL),
        smokeBaseUrlConfigured: Boolean(process.env.SMOKE_BASE_URL),
        releasePreviewConfigured: Boolean(process.env.RELEASE_PREVIEW_URL),
        releaseProductionConfigured: Boolean(process.env.RELEASE_PRODUCTION_URL),
        nextPublicBaseConfigured: Boolean(process.env.NEXT_PUBLIC_BASE_URL),
        vercelUrlConfigured: Boolean(process.env.VERCEL_URL),
      },
      true
    ),
    createCheck(
      "data-plane-query-health",
      "canonical",
      "critical",
      rawPricesCount >= 0 &&
        servingListCount >= 0 &&
        servingDetailCount >= 0 &&
        servingCompareCount >= 0 &&
        servingDiscoveryCount >= 0 &&
        servingSystemCount >= 0 &&
        requiredFieldGaps >= 0,
      "Critical DB counts and gap queries must complete without Prisma/timeout errors.",
      {
        rawPricesCount,
        servingListCount,
        servingDetailCount,
        servingCompareCount,
        servingDiscoveryCount,
        servingSystemCount,
        requiredFieldGaps,
      }
    ),
    createCheck(
      "canonical-latest-snapshot-required-fields",
      "canonical",
      "critical",
      requiredFieldGaps === 0,
      "Latest snapshot date must have zero rows with empty code/name or non-positive lastPrice.",
      { requiredFieldGaps, latestSnapshotDate: latestSnapshotDate?.toISOString() ?? null }
    ),
  ];

  const failedCritical = checks.filter((c) => c.status === "fail" && c.severity === "critical");
  const failedWarnings = checks.filter((c) => c.status !== "pass" && c.severity === "warning");

  const gateDecision = failedCritical.length === 0 ? "GO" : "NO_GO";
  const report = {
    ok: gateDecision === "GO",
    gateDecision,
    summary: {
      criticalFailed: failedCritical.length,
      warningFailedOrWarned: failedWarnings.length,
      totalChecks: checks.length,
    },
    canonical: {
      funds: fundCount,
      activeFunds: activeFundCount,
      latestHistoryDate: latestHistory?.date.toISOString() ?? null,
      latestSnapshotDate: latestSnapshot?.date.toISOString() ?? null,
      latestMarketDate: latestMarket?.date.toISOString() ?? null,
      latestMacroDate: latestMacro?.date.toISOString() ?? null,
    },
    dataPlatformV1: {
      rawPricesRowCount: rawPricesCount,
      rawPricesParseFailedCount: parseFailedRawCount,
      rawFailedSourceCount: failedRawSources,
      servingFundListRowCount: servingListCount,
      servingFundDetailRowCount: servingDetailCount,
      servingCompareRowCount: servingCompareCount,
      servingDiscoveryRowCount: servingDiscoveryCount,
      servingSystemRowCount: servingSystemCount,
      requiredFieldGaps,
      buildAligned: alignedBuildId,
      servingRowSemantics: {
        listCompareDiscoverySystem: "build_envelope_row",
        detail: "per_fund_row",
      },
      latestBuildEnvelopeRows: latestBuildRows,
      distinctBuildCounts: servingDistinctBuildCounts,
      latestBuildUniverse: servingUniverse,
      latestServingBuilds: heads
        ? {
            list: heads.fundList ? { buildId: heads.fundList.buildId, status: heads.fundList.status } : null,
            detail: heads.fundDetail ? { buildId: heads.fundDetail.buildId, code: heads.fundDetail.fundCode, status: heads.fundDetail.status } : null,
            compare: heads.compare ? { buildId: heads.compare.buildId, status: heads.compare.status } : null,
            discovery: heads.discovery ? { buildId: heads.discovery.buildId, status: heads.discovery.status } : null,
            system: heads.system ? { buildId: heads.system.buildId, status: heads.system.status } : null,
          }
        : null,
    },
    checks,
    verifyFinal: {
      gateDecision,
      exitCode: gateDecision === "GO" ? 0 : 1,
      authoritative: true,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  const exitCode = gateDecision === "GO" ? 0 : 1;
  console.error(`[data:verify] VERIFY_GATE_DECISION=${gateDecision} VERIFY_EXIT_CODE=${exitCode}`);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

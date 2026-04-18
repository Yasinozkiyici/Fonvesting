import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSystemHealthSnapshot } from "@/lib/system-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function allowHealthDetail(headers: Headers): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const configuredSecret = process.env.HEALTH_SECRET?.trim();
  const provided = headers.get("x-health-secret")?.trim();
  if (configuredSecret && provided && provided === configuredSecret) return true;
  const cronSecret = process.env.CRON_SECRET?.trim();
  const auth = headers.get("authorization")?.trim() ?? "";
  return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
}

export async function GET(request: Request) {
  if (!allowHealthDetail(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const [snapshot, rawCounts, servingHeads, servingAlignment] = await Promise.all([
    getSystemHealthSnapshot({ lightweight: false, includeExternalProbes: false }),
    Promise.all([
      prisma.rawMarketPayload.count().catch(() => -1),
      prisma.rawPricesPayload.count().catch(() => -1),
      prisma.rawFundMetadataPayload.count().catch(() => -1),
      prisma.rawPricesPayload.count({ where: { parseStatus: "FAILED" } }).catch(() => -1),
      prisma.rawPricesPayload.findFirst({ orderBy: { fetchedAt: "desc" }, select: { fetchedAt: true } }).catch(() => null),
    ]).then(([market, prices, meta, priceParseFailed, latestRawPrice]) => ({
      market,
      prices,
      metadata: meta,
      priceParseFailed,
      latestRawPriceFetchedAt: latestRawPrice?.fetchedAt?.toISOString() ?? null,
    })),
    prisma.servingSystemStatus.findFirst({ orderBy: { updatedAt: "desc" }, select: { buildId: true, updatedAt: true } }).catch(() => null),
    Promise.all([
      prisma.servingFundList.findFirst({ orderBy: { updatedAt: "desc" }, select: { buildId: true } }).catch(() => null),
      prisma.servingFundDetail.findFirst({ orderBy: { updatedAt: "desc" }, select: { buildId: true } }).catch(() => null),
      prisma.servingCompareInputs.findFirst({ orderBy: { updatedAt: "desc" }, select: { buildId: true } }).catch(() => null),
    ]).then(([list, detail, compare]) => ({
      listBuildId: list?.buildId ?? null,
      detailBuildId: detail?.buildId ?? null,
      compareBuildId: compare?.buildId ?? null,
      aligned: Boolean(list?.buildId && detail?.buildId && compare?.buildId && list.buildId === detail.buildId && detail.buildId === compare.buildId),
    })),
  ]);

  return NextResponse.json({
    ok: snapshot.database.canConnect,
    checkedAt: snapshot.checkedAt,
    freshness: snapshot.freshness,
    integrity: snapshot.integrity,
    jobs: snapshot.jobs,
    canonicalCounts: snapshot.counts,
    rawIngestionRowCounts: rawCounts,
    latestRawFetchTimestamp: rawCounts.latestRawPriceFetchedAt,
    latestCanonicalSnapshotDate: snapshot.freshness.latestFundSnapshotDate,
    latestServingBuildId: servingHeads?.buildId ?? null,
    buildAlignment: servingAlignment,
    dailyPipelineTruth: {
      dailySync: snapshot.jobs.dailySync,
      dailySyncStatus: snapshot.jobs.dailySyncStatus,
      issues: snapshot.issues.filter((issue) => issue.code.startsWith("daily_sync")),
    },
    freshnessAssessment: {
      status: snapshot.status,
      staleDays: snapshot.freshness.daysSinceLatestFundSnapshot,
    },
  });
}

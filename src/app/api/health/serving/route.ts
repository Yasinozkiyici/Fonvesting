import { NextResponse } from "next/server";
import { readLatestServingHeads } from "@/lib/data-platform/serving-head";
import { evaluateServingUniverseIntegrity } from "@/lib/data-platform/serving-integrity";
import { prisma } from "@/lib/prisma";

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

  const [heads, counts] = await Promise.all([
    readLatestServingHeads(),
    Promise.all([
      prisma.servingFundList.count().catch(() => -1),
      prisma.servingFundDetail.count().catch(() => -1),
      prisma.servingCompareInputs.count().catch(() => -1),
      prisma.servingDiscoveryIndex.count().catch(() => -1),
      prisma.servingSystemStatus.count().catch(() => -1),
      prisma.rawPricesPayload.count().catch(() => -1),
      prisma.rawPricesPayload.count({ where: { parseStatus: "FAILED" } }).catch(() => -1),
      prisma.fundDailySnapshot.count().catch(() => -1),
    ]).then(([list, detail, compare, discovery, system, rawPrices, rawParseFailed, canonicalSnapshots]) => ({
      list,
      detail,
      compare,
      discovery,
      system,
      rawPrices,
      rawParseFailed,
      canonicalSnapshots,
    })),
  ]);

  const latestBuildId = heads.fundList?.buildId ?? null;
  const latestBuildEnvelopeRows = latestBuildId
    ? await Promise.all([
        prisma.servingFundList.count({ where: { buildId: latestBuildId } }).catch(() => -1),
        prisma.servingCompareInputs.count({ where: { buildId: latestBuildId } }).catch(() => -1),
        prisma.servingDiscoveryIndex.count({ where: { buildId: latestBuildId } }).catch(() => -1),
        prisma.servingSystemStatus.count({ where: { buildId: latestBuildId } }).catch(() => -1),
        prisma.servingFundDetail.count({ where: { buildId: latestBuildId } }).catch(() => -1),
      ]).then(([list, compare, discovery, system, detail]) => ({ list, compare, discovery, system, detail }))
    : { list: -1, compare: -1, discovery: -1, system: -1, detail: -1 };

  const [activeFundCount, latestListPayload, latestComparePayload, latestDiscoveryPayload, detailCodeCount] = latestBuildId
    ? await Promise.all([
        prisma.fund.count({ where: { isActive: true } }).catch(() => 0),
        prisma.servingFundList.findFirst({ where: { buildId: latestBuildId }, orderBy: { updatedAt: "desc" }, select: { payload: true } }).catch(() => null),
        prisma.servingCompareInputs.findFirst({ where: { buildId: latestBuildId }, orderBy: { updatedAt: "desc" }, select: { payload: true } }).catch(() => null),
        prisma.servingDiscoveryIndex.findFirst({ where: { buildId: latestBuildId }, orderBy: { updatedAt: "desc" }, select: { payload: true } }).catch(() => null),
        prisma.servingFundDetail.count({ where: { buildId: latestBuildId } }).catch(() => 0),
      ])
    : [0, null, null, null, 0];
  const latestBuildUniverse = evaluateServingUniverseIntegrity({
    activeFundCount,
    listPayload: latestListPayload?.payload ?? null,
    comparePayload: latestComparePayload?.payload ?? null,
    discoveryPayload: latestDiscoveryPayload?.payload ?? null,
    detailCountForBuild: detailCodeCount,
  });

  const alignedBuildId =
    heads.fundList?.buildId &&
    heads.compare?.buildId &&
    heads.discovery?.buildId &&
    heads.system?.buildId &&
    heads.fundList.buildId === heads.compare.buildId &&
    heads.compare.buildId === heads.discovery.buildId &&
    heads.discovery.buildId === heads.system.buildId;
  const detailAligned = heads.fundDetail?.buildId ? heads.fundDetail.buildId === heads.fundList?.buildId : false;

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    rowCounts: counts,
    rowSemantics: {
      listCompareDiscoverySystem: "build_envelope_row",
      detail: "per_fund_row",
    },
    latestBuildEnvelopeRows,
    latestBuildUniverse,
    quality: {
      buildAligned: Boolean(alignedBuildId),
      detailAligned,
    },
    latest: {
      fundList: heads.fundList,
      fundDetail: heads.fundDetail,
      compare: heads.compare,
      discovery: heads.discovery,
      system: heads.system,
    },
  });
}

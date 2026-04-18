import { prisma } from "@/lib/prisma";

const servingHeadMetaSelect = {
  buildId: true,
  snapshotAsOf: true,
  updatedAt: true,
} as const;

/** Hot-path world resolution: build ids only, no large JSON payloads. */
export async function readLatestServingHeadsMeta() {
  const q = { orderBy: { updatedAt: "desc" as const }, select: servingHeadMetaSelect };
  const [fundList, fundDetail, compare, discovery, system] = await Promise.all([
    prisma.servingFundList.findFirst(q).catch(() => null),
    prisma.servingFundDetail.findFirst(q).catch(() => null),
    prisma.servingCompareInputs.findFirst(q).catch(() => null),
    prisma.servingDiscoveryIndex.findFirst(q).catch(() => null),
    prisma.servingSystemStatus.findFirst(q).catch(() => null),
  ]);
  return { fundList, fundDetail, compare, discovery, system };
}

export async function readLatestServingHeads() {
  const [
    fundList,
    fundDetail,
    compare,
    discovery,
    system,
  ] = await Promise.all([
    prisma.servingFundList.findFirst({ orderBy: { updatedAt: "desc" } }).catch(() => null),
    prisma.servingFundDetail.findFirst({ orderBy: { updatedAt: "desc" } }).catch(() => null),
    prisma.servingCompareInputs.findFirst({ orderBy: { updatedAt: "desc" } }).catch(() => null),
    prisma.servingDiscoveryIndex.findFirst({ orderBy: { updatedAt: "desc" } }).catch(() => null),
    prisma.servingSystemStatus.findFirst({ orderBy: { updatedAt: "desc" } }).catch(() => null),
  ]);

  return { fundList, fundDetail, compare, discovery, system };
}

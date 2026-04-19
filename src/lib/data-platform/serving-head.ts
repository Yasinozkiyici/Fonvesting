import { prisma } from "@/lib/prisma";

const servingHeadMetaSelect = {
  buildId: true,
  snapshotAsOf: true,
  updatedAt: true,
} as const;

/** Hot-path world resolution: build ids only, no large JSON payloads. */
export async function readLatestServingHeadsMeta() {
  const q = { orderBy: { updatedAt: "desc" as const }, select: servingHeadMetaSelect };
  // Keep these reads sequential to avoid pool checkout starvation
  // when workflows enforce a very low connection limit (e.g. 1).
  const fundList = await prisma.servingFundList.findFirst(q).catch(() => null);
  const fundDetail = await prisma.servingFundDetail.findFirst(q).catch(() => null);
  const compare = await prisma.servingCompareInputs.findFirst(q).catch(() => null);
  const discovery = await prisma.servingDiscoveryIndex.findFirst(q).catch(() => null);
  const system = await prisma.servingSystemStatus.findFirst(q).catch(() => null);
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

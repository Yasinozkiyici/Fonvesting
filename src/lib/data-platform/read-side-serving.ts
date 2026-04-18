import { prisma } from "@/lib/prisma";
import {
  readUiServingWorldMetaCached,
  type UiServingWorldMeta,
} from "@/lib/domain/serving/ui-cutover-contract";
import type { ServingReadTrust, ServingRouteSource } from "@/lib/data-platform/read-side-serving-trust";
export { enforceServingRouteTrust } from "@/lib/data-platform/read-side-serving-trust";

export type ServingListRow = {
  code: string;
  name: string;
  shortName: string | null;
  categoryCode: string | null;
  fundTypeCode: number | null;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  /** Lowercased tr-TR haystack for list search (code, name, shortName); not exposed on API rows. */
  searchHaystack: string;
};

type ServingListPayload = {
  buildId: string;
  snapshotAsOf: string;
  total: number;
  funds: ServingListRow[];
};

export type ServingCompareInputRow = {
  code: string;
  categoryCode: string | null;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
};

type ServingComparePayload = {
  buildId: string;
  snapshotAsOf: string;
  funds: ServingCompareInputRow[];
};

export type ServingDiscoveryRow = {
  rank: number;
  code: string;
  score: number;
  categoryCode: string | null;
  portfolioSize: number;
};

type ServingDiscoveryPayload = {
  buildId: string;
  snapshotAsOf: string;
  funds: ServingDiscoveryRow[];
};

type ServingSystemPayload = {
  buildId: string;
  snapshotAsOf: string;
  counts?: {
    canonical?: number;
  };
};

type ServingReadEnvelope<T> = {
  world: UiServingWorldMeta | null;
  payload: T | null;
  trust: ServingReadTrust;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeListPayload(value: unknown): ServingListPayload | null {
  const input = asRecord(value);
  if (!input) return null;
  const buildId = asString(input.buildId);
  const snapshotAsOf = asString(input.snapshotAsOf);
  const total = asNumber(input.total);
  const funds = Array.isArray(input.funds) ? input.funds : null;
  if (!buildId || !snapshotAsOf || total == null || !funds) return null;
  const rows: ServingListRow[] = [];
  for (const item of funds) {
    const row = asRecord(item);
    if (!row) continue;
    const code = asString(row.code);
    const name = asString(row.name);
    if (!code || !name) continue;
    const shortName = asString(row.shortName);
    const codeLc = code.toLocaleLowerCase("tr-TR");
    const nameLc = name.toLocaleLowerCase("tr-TR");
    const shortLc = (shortName ?? "").toLocaleLowerCase("tr-TR");
    rows.push({
      code,
      name,
      shortName,
      categoryCode: asString(row.categoryCode),
      fundTypeCode: asNumber(row.fundTypeCode),
      lastPrice: asNumber(row.lastPrice) ?? 0,
      dailyReturn: asNumber(row.dailyReturn) ?? 0,
      monthlyReturn: asNumber(row.monthlyReturn) ?? 0,
      yearlyReturn: asNumber(row.yearlyReturn) ?? 0,
      portfolioSize: asNumber(row.portfolioSize) ?? 0,
      investorCount: asNumber(row.investorCount) ?? 0,
      searchHaystack: `${codeLc}\n${nameLc}\n${shortLc}`,
    });
  }
  return { buildId, snapshotAsOf, total, funds: rows };
}

function normalizeComparePayload(value: unknown): ServingComparePayload | null {
  const input = asRecord(value);
  if (!input) return null;
  const buildId = asString(input.buildId);
  const snapshotAsOf = asString(input.snapshotAsOf);
  const funds = Array.isArray(input.funds) ? input.funds : null;
  if (!buildId || !snapshotAsOf || !funds) return null;
  const rows: ServingCompareInputRow[] = [];
  for (const item of funds) {
    const row = asRecord(item);
    if (!row) continue;
    const code = asString(row.code);
    if (!code) continue;
    rows.push({
      code,
      categoryCode: asString(row.categoryCode),
      dailyReturn: asNumber(row.dailyReturn) ?? 0,
      monthlyReturn: asNumber(row.monthlyReturn) ?? 0,
      yearlyReturn: asNumber(row.yearlyReturn) ?? 0,
      portfolioSize: asNumber(row.portfolioSize) ?? 0,
      investorCount: asNumber(row.investorCount) ?? 0,
    });
  }
  return { buildId, snapshotAsOf, funds: rows };
}

function normalizeDiscoveryPayload(value: unknown): ServingDiscoveryPayload | null {
  const input = asRecord(value);
  if (!input) return null;
  const buildId = asString(input.buildId);
  const snapshotAsOf = asString(input.snapshotAsOf);
  const funds = Array.isArray(input.funds) ? input.funds : null;
  if (!buildId || !snapshotAsOf || !funds) return null;
  const rows: ServingDiscoveryRow[] = [];
  for (const item of funds) {
    const row = asRecord(item);
    if (!row) continue;
    const code = asString(row.code);
    if (!code) continue;
    rows.push({
      rank: Math.max(0, Math.trunc(asNumber(row.rank) ?? 0)),
      code,
      score: asNumber(row.score) ?? 0,
      categoryCode: asString(row.categoryCode),
      portfolioSize: asNumber(row.portfolioSize) ?? 0,
    });
  }
  return { buildId, snapshotAsOf, funds: rows };
}

function normalizeSystemPayload(value: unknown): ServingSystemPayload | null {
  const input = asRecord(value);
  if (!input) return null;
  const buildId = asString(input.buildId);
  const snapshotAsOf = asString(input.snapshotAsOf);
  if (!buildId || !snapshotAsOf) return null;
  const countsInput = asRecord(input.counts);
  return {
    buildId,
    snapshotAsOf,
    counts: countsInput ? { canonical: asNumber(countsInput.canonical) ?? undefined } : undefined,
  };
}

function classifyServingRead(
  world: UiServingWorldMeta | null,
  payloadMissing: boolean,
  payloadInvalid: boolean
): ServingReadTrust {
  if (!world?.worldId) {
    return { trustAsFinal: false, degradedKind: "serving_world_missing", degradedReason: "world_id_missing" };
  }
  if (!world.worldAligned) {
    return {
      trustAsFinal: false,
      degradedKind: "serving_world_misaligned",
      degradedReason: "build_world_misaligned",
    };
  }
  if (payloadMissing) {
    return {
      trustAsFinal: false,
      degradedKind: "serving_payload_missing",
      degradedReason: "serving_payload_missing",
    };
  }
  if (payloadInvalid) {
    return {
      trustAsFinal: false,
      degradedKind: "serving_payload_invalid",
      degradedReason: "serving_payload_invalid",
    };
  }
  return { trustAsFinal: true, degradedKind: "none", degradedReason: null };
}

async function readServingWorld(): Promise<UiServingWorldMeta | null> {
  return readUiServingWorldMetaCached().catch(() => null);
}

export async function readServingFundListPrimary(): Promise<ServingReadEnvelope<ServingListPayload>> {
  const world = await readServingWorld();
  const row = await prisma.servingFundList.findFirst({ orderBy: { updatedAt: "desc" } }).catch(() => null);
  const payload = row ? normalizeListPayload(row.payload) : null;
  return {
    world,
    payload,
    trust: classifyServingRead(world, !row, Boolean(row && !payload)),
  };
}

export async function readServingComparePrimary(): Promise<ServingReadEnvelope<ServingComparePayload>> {
  const world = await readServingWorld();
  const row = await prisma.servingCompareInputs.findFirst({ orderBy: { updatedAt: "desc" } }).catch(() => null);
  const payload = row ? normalizeComparePayload(row.payload) : null;
  return {
    world,
    payload,
    trust: classifyServingRead(world, !row, Boolean(row && !payload)),
  };
}

export async function readServingDiscoveryPrimary(): Promise<ServingReadEnvelope<ServingDiscoveryPayload>> {
  const world = await readServingWorld();
  const row = await prisma.servingDiscoveryIndex.findFirst({ orderBy: { updatedAt: "desc" } }).catch(() => null);
  const payload = row ? normalizeDiscoveryPayload(row.payload) : null;
  return {
    world,
    payload,
    trust: classifyServingRead(world, !row, Boolean(row && !payload)),
  };
}

export async function readServingSystemPrimary(): Promise<ServingReadEnvelope<ServingSystemPayload>> {
  const world = await readServingWorld();
  const row = await prisma.servingSystemStatus.findFirst({ orderBy: { updatedAt: "desc" } }).catch(() => null);
  const payload = row ? normalizeSystemPayload(row.payload) : null;
  return {
    world,
    payload,
    trust: classifyServingRead(world, !row, Boolean(row && !payload)),
  };
}

export function servingHeaders(input: {
  world: UiServingWorldMeta | null;
  trust: ServingReadTrust;
  routeSource: ServingRouteSource | string;
  fallbackUsed: boolean;
}): Record<string, string> {
  return {
    "X-Serving-World-Id": input.world?.worldId ?? "none",
    "X-Serving-World-Aligned": input.world?.worldAligned ? "1" : "0",
    "X-Serving-Trust-Final": input.trust.trustAsFinal ? "1" : "0",
    "X-Serving-Degraded-Kind": input.trust.degradedKind,
    "X-Serving-Degraded-Reason": input.trust.degradedReason ?? "none",
    "X-Serving-Route-Source": input.routeSource,
    "X-Serving-Fallback-Used": input.fallbackUsed ? "1" : "0",
    "X-Serving-FundList-Build-Id": input.world?.buildIds.fundList ?? "none",
    "X-Serving-Discovery-Build-Id": input.world?.buildIds.discovery ?? "none",
    "X-Serving-Compare-Build-Id": input.world?.buildIds.compare ?? "none",
    "X-Serving-System-Build-Id": input.world?.buildIds.system ?? "none",
  };
}



import { parseFundThemeParam, type FundThemeId } from "@/lib/fund-themes";
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
  /** Kanonik keşif temaları (serving rebuild). */
  themeTags?: FundThemeId[];
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

export type ServingEnvelopeReadStrategy = "aligned_build" | "latest_updated";

export type ServingReadEnvelope<T> = {
  world: UiServingWorldMeta | null;
  payload: T | null;
  trust: ServingReadTrust;
  envelopeRead: ServingEnvelopeReadStrategy;
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

function parseThemeTagsField(raw: unknown): FundThemeId[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: FundThemeId[] = [];
  for (const item of raw) {
    const p = parseFundThemeParam(typeof item === "string" ? item : String(item));
    if (p) out.push(p);
  }
  return out.length > 0 ? out : undefined;
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
      themeTags: parseThemeTagsField(row.themeTags),
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

function resolveAlignedBuildId(world: UiServingWorldMeta | null): string | null {
  if (!world?.worldAligned) return null;
  const trimmed = (world.worldId ?? "").trim();
  return trimmed || null;
}

type ServingEnvelopeKind = "fundList" | "compare" | "discovery" | "system";

async function fetchServingEnvelopeRow(
  kind: ServingEnvelopeKind,
  buildId: string | null
): Promise<{ payload: unknown } | null> {
  const latest = { orderBy: { updatedAt: "desc" as const } };
  if (buildId) {
    if (kind === "fundList") return prisma.servingFundList.findFirst({ where: { buildId } }).catch(() => null);
    if (kind === "compare") return prisma.servingCompareInputs.findFirst({ where: { buildId } }).catch(() => null);
    if (kind === "discovery") return prisma.servingDiscoveryIndex.findFirst({ where: { buildId } }).catch(() => null);
    return prisma.servingSystemStatus.findFirst({ where: { buildId } }).catch(() => null);
  }
  if (kind === "fundList") return prisma.servingFundList.findFirst(latest).catch(() => null);
  if (kind === "compare") return prisma.servingCompareInputs.findFirst(latest).catch(() => null);
  if (kind === "discovery") return prisma.servingDiscoveryIndex.findFirst(latest).catch(() => null);
  return prisma.servingSystemStatus.findFirst(latest).catch(() => null);
}

async function readServingEnvelope<TPayload>(
  kind: ServingEnvelopeKind,
  normalize: (raw: unknown) => TPayload | null,
  worldHint?: UiServingWorldMeta | null
): Promise<ServingReadEnvelope<TPayload>> {
  const world = worldHint === undefined ? await readServingWorld() : worldHint;
  const alignedId = resolveAlignedBuildId(world);
  if (alignedId) {
    const row = await fetchServingEnvelopeRow(kind, alignedId);
    if (!row) {
      return {
        world,
        payload: null,
        trust: classifyServingRead(world, true, false),
        envelopeRead: "aligned_build",
      };
    }
    const payload = normalize(row.payload);
    return {
      world,
      payload,
      trust: classifyServingRead(world, false, Boolean(row && !payload)),
      envelopeRead: "aligned_build",
    };
  }
  const row = await fetchServingEnvelopeRow(kind, null);
  const payload = row ? normalize(row.payload) : null;
  return {
    world,
    payload,
    trust: classifyServingRead(world, !row, Boolean(row && !payload)),
    envelopeRead: "latest_updated",
  };
}

export async function readServingFundListPrimary(
  worldHint?: UiServingWorldMeta | null
): Promise<ServingReadEnvelope<ServingListPayload>> {
  return readServingEnvelope("fundList", normalizeListPayload, worldHint);
}

export async function readServingComparePrimary(
  worldHint?: UiServingWorldMeta | null
): Promise<ServingReadEnvelope<ServingComparePayload>> {
  return readServingEnvelope("compare", normalizeComparePayload, worldHint);
}

export async function readServingDiscoveryPrimary(
  worldHint?: UiServingWorldMeta | null
): Promise<ServingReadEnvelope<ServingDiscoveryPayload>> {
  return readServingEnvelope("discovery", normalizeDiscoveryPayload, worldHint);
}

export async function readServingSystemPrimary(
  worldHint?: UiServingWorldMeta | null
): Promise<ServingReadEnvelope<ServingSystemPayload>> {
  return readServingEnvelope("system", normalizeSystemPayload, worldHint);
}

export function servingHeaders(input: {
  world: UiServingWorldMeta | null;
  trust: ServingReadTrust;
  routeSource: ServingRouteSource | string;
  fallbackUsed: boolean;
  envelopeRead?: ServingEnvelopeReadStrategy;
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
    ...(input.envelopeRead ? { "X-Serving-Envelope-Read": input.envelopeRead } : {}),
  };
}



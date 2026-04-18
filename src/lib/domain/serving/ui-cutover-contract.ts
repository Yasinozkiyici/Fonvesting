import { readLatestServingHeadsMeta } from "@/lib/data-platform/serving-head";
import { resolveServingWorldFromBuildIds } from "@/lib/domain/serving/world-id";

type ServingHeadRecord = {
  buildId?: string | null;
  snapshotAsOf?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type UiServingWorldMeta = {
  worldId: string | null;
  worldAligned: boolean;
  headsPresent: Array<"fundList" | "fundDetail" | "compare" | "discovery" | "system">;
  buildIds: {
    fundList: string | null;
    fundDetail: string | null;
    compare: string | null;
    discovery: string | null;
    system: string | null;
  };
  snapshotAsOf: {
    fundList: string | null;
    fundDetail: string | null;
    compare: string | null;
    discovery: string | null;
    system: string | null;
  };
  generatedAtIso: string;
};

function normalizeIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function normalizeBuildId(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

export async function readUiServingWorldMeta(): Promise<UiServingWorldMeta> {
  const heads = await readLatestServingHeadsMeta();
  const buildIds = {
    fundList: normalizeBuildId((heads.fundList as ServingHeadRecord | null)?.buildId),
    fundDetail: normalizeBuildId((heads.fundDetail as ServingHeadRecord | null)?.buildId),
    compare: normalizeBuildId((heads.compare as ServingHeadRecord | null)?.buildId),
    discovery: normalizeBuildId((heads.discovery as ServingHeadRecord | null)?.buildId),
    system: normalizeBuildId((heads.system as ServingHeadRecord | null)?.buildId),
  };
  const snapshotAsOf = {
    fundList: normalizeIso((heads.fundList as ServingHeadRecord | null)?.snapshotAsOf),
    fundDetail: normalizeIso((heads.fundDetail as ServingHeadRecord | null)?.snapshotAsOf),
    compare: normalizeIso((heads.compare as ServingHeadRecord | null)?.snapshotAsOf),
    discovery: normalizeIso((heads.discovery as ServingHeadRecord | null)?.snapshotAsOf),
    system: normalizeIso((heads.system as ServingHeadRecord | null)?.snapshotAsOf),
  };
  const headsPresent = (Object.entries(buildIds) as Array<[keyof typeof buildIds, string | null]>)
    .filter(([, buildId]) => Boolean(buildId))
    .map(([key]) => key);
  const world = resolveServingWorldFromBuildIds(buildIds);
  return {
    worldId: world.worldId,
    worldAligned: world.worldAligned,
    headsPresent,
    buildIds,
    snapshotAsOf,
    generatedAtIso: new Date().toISOString(),
  };
}

const WORLD_META_CACHE_TTL_MS = 1_500;
let worldMetaCache: { at: number; value: UiServingWorldMeta } | null = null;
let worldMetaInflight: Promise<UiServingWorldMeta> | null = null;

/**
 * Short-TTL memo of {@link readUiServingWorldMeta} with in-flight deduplication.
 * Cuts duplicate head reads when multiple serving primaries run in parallel on the same request.
 */
export async function readUiServingWorldMetaCached(): Promise<UiServingWorldMeta> {
  const now = Date.now();
  if (worldMetaCache && now - worldMetaCache.at < WORLD_META_CACHE_TTL_MS) {
    return worldMetaCache.value;
  }
  if (worldMetaInflight) return worldMetaInflight;
  worldMetaInflight = readUiServingWorldMeta()
    .then((value) => {
      worldMetaCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      worldMetaInflight = null;
    });
  return worldMetaInflight;
}


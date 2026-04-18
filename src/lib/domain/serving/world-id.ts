export type ServingBuildIdMap = {
  fundList: string | null;
  fundDetail: string | null;
  compare: string | null;
  discovery: string | null;
  system: string | null;
};

export function resolveServingWorldFromBuildIds(
  ids: ServingBuildIdMap
): { worldId: string | null; worldAligned: boolean } {
  const candidates = Object.values(ids).filter((value): value is string => Boolean(value));
  if (candidates.length === 0) return { worldId: null, worldAligned: false };
  const canonical = candidates[0] ?? null;
  if (!canonical) return { worldId: null, worldAligned: false };
  return { worldId: canonical, worldAligned: candidates.every((value) => value === canonical) };
}


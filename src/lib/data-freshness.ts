import { prisma } from "@/lib/prisma";

export const LIVE_DATA_CACHE_SEC = 300;
export const LIVE_DATA_SWR_SEC = 600;
export const LIVE_DATA_PAGE_REVALIDATE_SEC = 300;

export function liveDataCacheControl(
  maxAge: number = LIVE_DATA_CACHE_SEC,
  staleWhileRevalidate: number = LIVE_DATA_SWR_SEC
): string {
  return `s-maxage=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
}

type SnapshotHead = {
  date: Date;
  updatedAt: Date;
} | null;

type MarketHead = {
  date: Date;
  createdAt: Date;
} | null;

type ScoresHead = {
  updatedAt: Date;
} | null;

type MacroHead = {
  date: Date;
  updatedAt: Date;
} | null;

const HEAD_CACHE_TTL_MS = 30_000;

const headCache = new Map<string, { expiresAt: number; value: unknown }>();

async function readHeadWithLocalCache<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = headCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }
  const value = await loader();
  headCache.set(key, { expiresAt: now + HEAD_CACHE_TTL_MS, value });
  return value;
}

const readLatestSnapshot = async (): Promise<SnapshotHead> => {
  return readHeadWithLocalCache("latestSnapshot", () =>
    prisma.fundDailySnapshot.findFirst({
      orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
      select: { date: true, updatedAt: true },
    })
  );
};

const readLatestMarketSnapshot = async (): Promise<MarketHead> => {
  return readHeadWithLocalCache("latestMarketSnapshot", () =>
    prisma.marketSnapshot.findFirst({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: { date: true, createdAt: true },
    })
  );
};

const readLatestScoresCache = async (): Promise<ScoresHead> => {
  return readHeadWithLocalCache("latestScoresCache", () =>
    prisma.scoresApiCache.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    })
  );
};

const readLatestMacroObservation = async (): Promise<MacroHead> => {
  return readHeadWithLocalCache("latestMacroObservation", () =>
    prisma.macroObservation.findFirst({
      orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
      select: { date: true, updatedAt: true },
    })
  );
};

function stamp(date: Date | null | undefined): string {
  return date ? date.toISOString() : "none";
}

export const readServingDataVersion = async (): Promise<string> => {
  const [latestSnapshot, latestMarketSnapshot] = await Promise.all([
    readLatestSnapshot(),
    readLatestMarketSnapshot(),
  ]);
  return [
    stamp(latestSnapshot?.date),
    stamp(latestSnapshot?.updatedAt),
    stamp(latestMarketSnapshot?.date),
    stamp(latestMarketSnapshot?.createdAt),
  ].join("|");
};

export const readScoresDataVersion = async (): Promise<string> => {
  const [latestSnapshot, latestScoresCache] = await Promise.all([
    readLatestSnapshot(),
    readLatestScoresCache(),
  ]);
  return [
    stamp(latestSnapshot?.date),
    stamp(latestSnapshot?.updatedAt),
    stamp(latestScoresCache?.updatedAt),
  ].join("|");
};

export const readLatestSnapshotHead = async (): Promise<SnapshotHead> => {
  return readLatestSnapshot();
};

export const readFundDetailVersion = async (): Promise<string> => {
  const latestSnapshot = await readLatestSnapshot();
  return [stamp(latestSnapshot?.date), stamp(latestSnapshot?.updatedAt)].join("|");
};

export const readMacroDataVersion = async (): Promise<string> => {
  const latestMacroObservation = await readLatestMacroObservation();
  return [
    stamp(latestMacroObservation?.date),
    stamp(latestMacroObservation?.updatedAt),
  ].join("|");
};

export const readCompareDataVersion = async (): Promise<string> => {
  const [latestSnapshot, latestMacroObservation] = await Promise.all([
    readLatestSnapshot(),
    readLatestMacroObservation(),
  ]);
  return [
    stamp(latestSnapshot?.date),
    stamp(latestSnapshot?.updatedAt),
    stamp(latestMacroObservation?.date),
    stamp(latestMacroObservation?.updatedAt),
  ].join("|");
};

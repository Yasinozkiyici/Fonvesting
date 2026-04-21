import { prisma, resetPrismaEngine } from "@/lib/prisma";
import type { RankingMode } from "@/lib/scoring";
import { Prisma } from "@prisma/client";
import { classifyDatabaseError } from "@/lib/database-error-classifier";
import {
  computeScoresPayload,
  filterScoresPayloadByQuery,
  type ScoresApiPayload,
} from "@/lib/services/fund-scores-compute.service";
import { createScoresPayload } from "@/lib/services/fund-scores-semantics";
import { getScoresPayloadFromDailySnapshot } from "@/lib/services/fund-daily-snapshot.service";
import { normalizeScoresPayloadFundTypes } from "@/lib/fund-type-display";
import { fundTypeForApi } from "@/lib/fund-type-display";
import { fetchSupabaseRestJson, hasSupabaseRestConfig } from "@/lib/supabase-rest";
import { LIVE_DATA_CACHE_SEC } from "@/lib/data-freshness";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import type { ScoredFundRow } from "@/lib/services/fund-scores-types";

const KEY_PREFIX = "scores:v9";
const DB_SCORES_STALE_MS = 23 * 60 * 60 * 1000;
const MEMORY_SCORES_TTL_MS = 5 * 60 * 1000;

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTransientPrismaRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      const classified = classifyDatabaseError(error);
      if (!classified.retryable || attempt >= 3) {
        throw error;
      }
      console.warn(
        `[scores-cache] transient_db_error attempt=${attempt} label=${label} class=${classified.category} ` +
          `prisma_code=${classified.prismaCode ?? "none"}`
      );
      await resetPrismaEngine();
      await sleepMs(500 * attempt);
    }
  }
  throw last;
}

type ScoresMemoryCacheEntry = {
  updatedAt: number;
  payload: ScoresApiPayload;
};

type GlobalWithScoresMemory = typeof globalThis & {
  __scoresMemoryCache?: Map<string, ScoresMemoryCacheEntry>;
};

function getScoresMemoryCache(): Map<string, ScoresMemoryCacheEntry> {
  const g = globalThis as GlobalWithScoresMemory;
  if (!g.__scoresMemoryCache) {
    g.__scoresMemoryCache = new Map<string, ScoresMemoryCacheEntry>();
  }
  return g.__scoresMemoryCache;
}

type SupabaseScoresCacheRow = {
  payload: ScoresApiPayload;
  updatedAt: string;
};

type SupabaseSnapshotDateRow = { date: string };
type SupabaseScoredSnapshotRow = {
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  lastPrice: number;
  dailyReturn: number;
  portfolioSize: number;
  investorCount: number;
  categoryCode: string | null;
  categoryName: string | null;
  fundTypeCode: number | null;
  fundTypeName: string | null;
  finalScoreBest: number;
  finalScoreLowRisk: number;
  finalScoreHighReturn: number;
  finalScoreStable: number;
};

function isRelationMissingError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021";
}

export function scoresApiCacheKey(mode: RankingMode, categoryKey: string, queryTrim = ""): string {
  const q = queryTrim.trim();
  const qPart = q ? `:q:${q.slice(0, 64)}` : "";
  return `${KEY_PREFIX}:${mode}:${categoryKey || "all"}${qPart}`;
}

function enrichScoresPayloadLogos(payload: ScoresApiPayload): ScoresApiPayload {
  return {
    ...payload,
    funds: payload.funds.map((fund) => ({
      ...fund,
      logoUrl: getFundLogoUrlForUi(fund.fundId, fund.code, fund.logoUrl, fund.name),
    })),
  };
}

function scoreFieldForMode(mode: RankingMode): keyof Pick<
  SupabaseScoredSnapshotRow,
  "finalScoreBest" | "finalScoreLowRisk" | "finalScoreHighReturn" | "finalScoreStable"
> {
  if (mode === "LOW_RISK") return "finalScoreLowRisk";
  if (mode === "HIGH_RETURN") return "finalScoreHighReturn";
  if (mode === "STABLE") return "finalScoreStable";
  return "finalScoreBest";
}

type SupabaseFundIdRow = { id: string };
type SupabaseFundMasterRow = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  categoryId: string | null;
  fundTypeId: string | null;
};
type SupabaseCategoryLookup = { id: string; code: string; name: string };
type SupabaseFundTypeLookup = { id: string; code: number; name: string };

/** Snapshot’ta satırı olmayan aktif Fund kayıtlarını REST ile ekler (Prisma yolu yoksa). */
async function mergeSupabaseActiveFundsMissingFromSnapshot(
  categoryKey: string,
  fromSnapshot: ScoredFundRow[]
): Promise<ScoredFundRow[]> {
  const present = new Set(fromSnapshot.map((f) => f.fundId));
  const activeRows = await fetchSupabaseRestJson<SupabaseFundIdRow[]>(
    "Fund?select=id&isActive=eq.true&limit=16000",
    { revalidate: LIVE_DATA_CACHE_SEC }
  );
  const missingIds = activeRows.map((r) => r.id).filter((id) => !present.has(id));
  if (missingIds.length === 0) return fromSnapshot;

  const [catRows, typeRows] = await Promise.all([
    fetchSupabaseRestJson<SupabaseCategoryLookup[]>("FundCategory?select=id,code,name&limit=500", {
      revalidate: LIVE_DATA_CACHE_SEC,
    }),
    fetchSupabaseRestJson<SupabaseFundTypeLookup[]>("FundType?select=id,code,name&limit=500", {
      revalidate: LIVE_DATA_CACHE_SEC,
    }),
  ]);
  const catById = new Map(catRows.map((c) => [c.id, c]));
  const typeById = new Map(typeRows.map((t) => [t.id, t]));

  const extra: ScoredFundRow[] = [];
  const chunkSize = 100;
  for (let i = 0; i < missingIds.length; i += chunkSize) {
    const chunk = missingIds.slice(i, i + chunkSize);
    const inClause = chunk.join(",");
    const fetched = await fetchSupabaseRestJson<SupabaseFundMasterRow[]>(
      `Fund?select=id,code,name,shortName,logoUrl,lastPrice,dailyReturn,monthlyReturn,yearlyReturn,portfolioSize,investorCount,categoryId,fundTypeId&id=in.(${inClause})`,
      { revalidate: LIVE_DATA_CACHE_SEC }
    );
    for (const row of fetched) {
      const cat = row.categoryId ? catById.get(row.categoryId) : null;
      if (categoryKey && cat?.code !== categoryKey) continue;
      const ft = row.fundTypeId ? typeById.get(row.fundTypeId) : null;
      extra.push({
        fundId: row.id,
        code: row.code,
        name: row.name,
        shortName: row.shortName,
        logoUrl: getFundLogoUrlForUi(row.id, row.code, row.logoUrl, row.name),
        lastPrice: row.lastPrice,
        dailyReturn: row.dailyReturn,
        portfolioSize: row.portfolioSize,
        investorCount: row.investorCount,
        category: cat ? { code: cat.code, name: cat.name } : null,
        fundType: ft ? fundTypeForApi({ code: ft.code, name: ft.name }) : null,
        finalScore: null,
      });
    }
  }

  const merged = [...fromSnapshot, ...extra];
  merged.sort((a, b) => {
    const fa = a.finalScore;
    const fb = b.finalScore;
    const am = fa == null || !Number.isFinite(fa);
    const bm = fb == null || !Number.isFinite(fb);
    if (!am && !bm && fb !== fa) return fb - fa;
    if (am !== bm) return am ? 1 : -1;
    return a.code.localeCompare(b.code, "tr");
  });
  return merged;
}

async function getScoresPayloadFromSupabaseRest(
  mode: RankingMode,
  categoryKey: string,
  queryTrim = ""
): Promise<ScoresApiPayload> {
  if (!hasSupabaseRestConfig()) {
    throw new Error("supabase_rest_not_configured");
  }

  const cacheKey = scoresApiCacheKey(mode, categoryKey, "");
  const cacheRows = await fetchSupabaseRestJson<SupabaseScoresCacheRow[]>(
    `ScoresApiCache?select=payload,updatedAt&cacheKey=eq.${encodeURIComponent(cacheKey)}&limit=1`,
    { revalidate: LIVE_DATA_CACHE_SEC }
  );
  const cachedRow = cacheRows[0];
  if (
    cachedRow?.payload &&
    Number.isFinite(Date.parse(cachedRow.updatedAt)) &&
    Date.now() - Date.parse(cachedRow.updatedAt) < DB_SCORES_STALE_MS
  ) {
    const payload = enrichScoresPayloadLogos(normalizeScoresPayloadFundTypes(cachedRow.payload));
    return queryTrim ? filterScoresPayloadByQuery(payload, queryTrim) : payload;
  }

  const latestRows = await fetchSupabaseRestJson<SupabaseSnapshotDateRow[]>(
    "FundDailySnapshot?select=date&order=date.desc&limit=1",
    { revalidate: LIVE_DATA_CACHE_SEC }
  );
  const latestDate = latestRows[0]?.date;
  if (!latestDate) {
    return createScoresPayload({ mode, funds: [], universeTotal: 0, matchedTotal: 0 });
  }

  const scoreField = scoreFieldForMode(mode);
  const query = new URLSearchParams({
    select: [
      "fundId",
      "code",
      "name",
      "shortName",
      "logoUrl",
      "lastPrice",
      "dailyReturn",
      "portfolioSize",
      "investorCount",
      "categoryCode",
      "categoryName",
      "fundTypeCode",
      "fundTypeName",
      "finalScoreBest",
      "finalScoreLowRisk",
      "finalScoreHighReturn",
      "finalScoreStable",
    ].join(","),
    date: `eq.${latestDate}`,
    order: `${scoreField}.desc,code.asc`,
    limit: "12000",
  });
  if (categoryKey) {
    query.set("categoryCode", `eq.${categoryKey}`);
  }
  const rows = await fetchSupabaseRestJson<SupabaseScoredSnapshotRow[]>(
    `FundDailySnapshot?${query.toString()}`,
    { revalidate: LIVE_DATA_CACHE_SEC }
  );

  const fromSnapshot: ScoredFundRow[] = rows.map((row) => ({
    fundId: row.fundId,
    code: row.code,
    finalScore: row[scoreField],
    name: row.name,
    shortName: row.shortName,
    logoUrl: getFundLogoUrlForUi(row.fundId, row.code, row.logoUrl, row.name),
    lastPrice: row.lastPrice,
    dailyReturn: row.dailyReturn,
    portfolioSize: row.portfolioSize,
    investorCount: row.investorCount,
    category:
      row.categoryCode && row.categoryName ? { code: row.categoryCode, name: row.categoryName } : null,
    fundType:
      row.fundTypeCode != null && row.fundTypeName
        ? fundTypeForApi({ code: row.fundTypeCode, name: row.fundTypeName })
        : null,
  }));

  let funds = fromSnapshot;
  try {
    funds = await mergeSupabaseActiveFundsMissingFromSnapshot(categoryKey, fromSnapshot);
  } catch (e) {
    console.warn("[scores-cache] supabase universe merge skipped", e);
  }

  const payload = enrichScoresPayloadLogos(
    createScoresPayload({
      mode,
      funds,
      universeTotal: funds.length,
      matchedTotal: funds.length,
    })
  );

  return queryTrim ? filterScoresPayloadByQuery(payload, queryTrim) : payload;
}

/**
 * Önce Postgres’teki günlük önbelleğe bakar; yoksa hesaplar ve kaydeder.
 * ScoresApiCache tablosu yoksa (migrate edilmemiş Supabase vb.) önbelleği atlayıp
 * yalnızca hesaplanan yanıtı döner — API 500 vermez.
 */
export async function getScoresPayloadCached(
  mode: RankingMode,
  categoryKey: string,
  queryTrim = ""
): Promise<ScoresApiPayload> {
  const cacheKey = scoresApiCacheKey(mode, categoryKey, "");
  const normalizedQuery = queryTrim.trim();
  const memory = getScoresMemoryCache();
  const memoryHit = memory.get(cacheKey);
  if (memoryHit && Date.now() - memoryHit.updatedAt < MEMORY_SCORES_TTL_MS) {
    return normalizedQuery
      ? filterScoresPayloadByQuery(memoryHit.payload, normalizedQuery)
      : memoryHit.payload;
  }

  try {
    const row = await prisma.scoresApiCache.findUnique({ where: { cacheKey } });
    const cacheIsFresh = row?.payload != null && Date.now() - row.updatedAt.getTime() < DB_SCORES_STALE_MS;
    if (cacheIsFresh && row?.payload != null) {
      const payload = normalizeScoresPayloadFundTypes(row.payload as unknown as ScoresApiPayload);
      memory.set(cacheKey, { updatedAt: Date.now(), payload });
      return normalizedQuery ? filterScoresPayloadByQuery(payload, normalizedQuery) : payload;
    }
  } catch (e) {
    if (!isRelationMissingError(e)) throw e;
  }

  const fromSnapshot = await getScoresPayloadFromDailySnapshot(mode, categoryKey, { includeTotal: true });
  if (fromSnapshot) {
    const payload = enrichScoresPayloadLogos(fromSnapshot);
    memory.set(cacheKey, { updatedAt: Date.now(), payload });
    return normalizedQuery ? filterScoresPayloadByQuery(payload, normalizedQuery) : payload;
  }

  const payload = await computeScoresPayload(mode, categoryKey, "");
  memory.set(cacheKey, { updatedAt: Date.now(), payload });

  const persistOnRead = process.env.SCORES_CACHE_PERSIST_ON_READ === "1";
  if (persistOnRead) {
    try {
      const json = JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
      await prisma.scoresApiCache.upsert({
        where: { cacheKey },
        create: { cacheKey, payload: json },
        update: { payload: json },
      });
    } catch (e) {
      if (!isRelationMissingError(e)) throw e;
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[scores-cache] ScoresApiCache tablosu yok; yanıt hesaplandı ama kaydedilmedi. Üretimde hız için: prisma migrate deploy"
        );
      }
    }
  }

  const enrichedPayload = enrichScoresPayloadLogos(payload);
  return normalizedQuery ? filterScoresPayloadByQuery(enrichedPayload, normalizedQuery) : enrichedPayload;
}

export async function getScoresPayloadServerCached(
  mode: RankingMode,
  categoryKey: string,
  queryTrim = ""
): Promise<ScoresApiPayload> {
  const payload = await getScoresPayloadCached(mode, categoryKey, "");
  return queryTrim.trim() ? filterScoresPayloadByQuery(payload, queryTrim) : payload;
}

export async function getScoresPayloadServerCachedSafe(
  mode: RankingMode,
  categoryKey: string,
  queryTrim = ""
): Promise<ScoresApiPayload | null> {
  try {
    return await getScoresPayloadServerCached(mode, categoryKey, queryTrim);
  } catch (error) {
    console.error("[scores-cache] server preload failed", error);
    return null;
  }
}

/**
 * Günlük TEFAS senkronu sonunda çağrılır: tüm sıralama modları × kategori kodları için önbellek yazar.
 */
export async function warmAllScoresApiCaches(): Promise<{ written: number }> {
  try {
    await prisma.scoresApiCache.findFirst();
  } catch (e) {
    if (isRelationMissingError(e)) {
      throw new Error(
        "ScoresApiCache tablosu bu veritabanında yok. Aynı DATABASE_URL ile çalıştırın: pnpm exec prisma migrate deploy"
      );
    }
    throw e;
  }

  const modes: RankingMode[] = ["BEST", "LOW_RISK", "HIGH_RETURN", "STABLE"];
  const categories = await prisma.fundCategory.findMany({ select: { code: true } });
  const categoryKeys = ["", ...categories.map((c) => c.code)];

  let written = 0;
  for (const mode of modes) {
    for (const cat of categoryKeys) {
      const cacheKey = scoresApiCacheKey(mode, cat, "");
      const payload = await withTransientPrismaRetry(`compute:${cacheKey}`, () =>
        computeScoresPayload(mode, cat, "")
      );
      const json = JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
      await withTransientPrismaRetry(`upsert:${cacheKey}`, () =>
        prisma.scoresApiCache.upsert({
          where: { cacheKey },
          create: { cacheKey, payload: json },
          update: { payload: json },
        })
      );
      written++;
    }
  }
  return { written };
}

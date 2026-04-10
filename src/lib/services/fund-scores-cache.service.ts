import { prisma } from "@/lib/prisma";
import type { RankingMode } from "@/lib/scoring";
import { Prisma } from "@prisma/client";
import {
  computeScoresPayload,
  filterScoresPayloadByQuery,
  type ScoresApiPayload,
} from "@/lib/services/fund-scores-compute.service";
import { normalizeScoresPayloadFundTypes } from "@/lib/fund-type-display";
import { fundTypeForApi } from "@/lib/fund-type-display";
import { fetchSupabaseRestJson, hasSupabaseRestConfig } from "@/lib/supabase-rest";
import { LIVE_DATA_CACHE_SEC } from "@/lib/data-freshness";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";

const KEY_PREFIX = "scores:v8";
const DB_SCORES_STALE_MS = 23 * 60 * 60 * 1000;

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
    return { mode, total: 0, funds: [] };
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
    limit: "3000",
  });
  if (categoryKey) {
    query.set("categoryCode", `eq.${categoryKey}`);
  }
  const rows = await fetchSupabaseRestJson<SupabaseScoredSnapshotRow[]>(
    `FundDailySnapshot?${query.toString()}`,
    { revalidate: LIVE_DATA_CACHE_SEC }
  );

  const payload = enrichScoresPayloadLogos({
    mode,
    total: rows.length,
    funds: rows.map((row) => ({
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
        row.categoryCode && row.categoryName
          ? { code: row.categoryCode, name: row.categoryName }
          : null,
      fundType:
        row.fundTypeCode != null && row.fundTypeName
          ? fundTypeForApi({ code: row.fundTypeCode, name: row.fundTypeName })
          : null,
    })),
  });

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
  if (hasSupabaseRestConfig()) {
    try {
      return await getScoresPayloadFromSupabaseRest(mode, categoryKey, queryTrim);
    } catch (error) {
      console.error("[scores-cache] supabase-rest fallback failed", error);
    }
  }

  const cacheKey = scoresApiCacheKey(mode, categoryKey, "");
  const normalizedQuery = queryTrim.trim();

  try {
    const row = await prisma.scoresApiCache.findUnique({ where: { cacheKey } });
    const cacheIsFresh = row?.payload != null && Date.now() - row.updatedAt.getTime() < DB_SCORES_STALE_MS;
    if (cacheIsFresh && row?.payload != null) {
      const payload = normalizeScoresPayloadFundTypes(row.payload as unknown as ScoresApiPayload);
      return normalizedQuery ? filterScoresPayloadByQuery(payload, normalizedQuery) : payload;
    }
  } catch (e) {
    if (!isRelationMissingError(e)) throw e;
  }

  const payload = await computeScoresPayload(mode, categoryKey, "");

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
      const payload = await computeScoresPayload(mode, cat, "");
      const cacheKey = scoresApiCacheKey(mode, cat, "");
      const json = JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
      await prisma.scoresApiCache.upsert({
        where: { cacheKey },
        create: { cacheKey, payload: json },
        update: { payload: json },
      });
      written++;
    }
  }
  return { written };
}

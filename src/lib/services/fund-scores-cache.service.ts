import { prisma } from "@/lib/prisma";
import type { RankingMode } from "@/lib/scoring";
import { Prisma } from "@prisma/client";
import { computeScoresPayload, type ScoresApiPayload } from "@/lib/services/fund-scores-compute.service";
import { normalizeScoresPayloadFundTypes } from "@/lib/fund-type-display";

const KEY_PREFIX = "scores:v3";

function isRelationMissingError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021";
}

export function scoresApiCacheKey(mode: RankingMode, categoryKey: string): string {
  return `${KEY_PREFIX}:${mode}:${categoryKey || "all"}`;
}

/**
 * Önce Postgres’teki günlük önbelleğe bakar; yoksa hesaplar ve kaydeder.
 * ScoresApiCache tablosu yoksa (migrate edilmemiş Supabase vb.) önbelleği atlayıp
 * yalnızca hesaplanan yanıtı döner — API 500 vermez.
 */
export async function getScoresPayloadCached(mode: RankingMode, categoryKey: string): Promise<ScoresApiPayload> {
  const cacheKey = scoresApiCacheKey(mode, categoryKey);

  try {
    const row = await prisma.scoresApiCache.findUnique({ where: { cacheKey } });
    if (row?.payload != null) {
      return normalizeScoresPayloadFundTypes(row.payload as unknown as ScoresApiPayload);
    }
  } catch (e) {
    if (!isRelationMissingError(e)) throw e;
  }

  const payload = await computeScoresPayload(mode, categoryKey);

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

  return payload;
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
      const payload = await computeScoresPayload(mode, cat);
      const cacheKey = scoresApiCacheKey(mode, cat);
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

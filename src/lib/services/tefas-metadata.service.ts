import type { PrismaClient } from "@prisma/client";
import { inferTefasCategoryCode, TEFAS_CATEGORY_SEED } from "@/lib/tefas-category";
import { resolveFundLogoUrl } from "@/lib/services/fund-logo.service";

/** TEFAS arayüzüyle uyumlu kategori satırlarını upsert eder. */
export async function ensureTefasFundCategories(client: PrismaClient): Promise<Map<string, string>> {
  const idByCode = new Map<string, string>();
  for (const row of TEFAS_CATEGORY_SEED) {
    const c = await client.fundCategory.upsert({
      where: { code: row.code },
      create: {
        code: row.code,
        name: row.name,
        color: row.color,
        description: row.description,
      },
      update: { name: row.name, color: row.color, description: row.description },
    });
    idByCode.set(row.code, c.id);
  }
  return idByCode;
}

/** Fon adına göre categoryId atar; eşleşmezse "Diğer" (DGR). Toplu updateMany. */
export async function assignFundCategoriesFromNames(client: PrismaClient): Promise<{ updated: number }> {
  const cats = await client.fundCategory.findMany({ select: { id: true, code: true } });
  const idByCode = new Map(cats.map((c) => [c.code, c.id]));
  const fallbackId = idByCode.get("DGR") ?? null;

  const funds = await client.fund.findMany({
    where: { isActive: true },
    select: { id: true, name: true, categoryId: true },
  });

  const byCategory = new Map<string, string[]>();
  for (const f of funds) {
    const inferred = inferTefasCategoryCode(f.name);
    const categoryId = inferred ? idByCode.get(inferred) ?? fallbackId : fallbackId;
    if (!categoryId) continue;
    if (f.categoryId === categoryId) continue;
    const list = byCategory.get(categoryId) ?? [];
    list.push(f.id);
    byCategory.set(categoryId, list);
  }

  let updated = 0;
  for (const [categoryId, ids] of byCategory) {
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const r = await client.fund.updateMany({
        where: { id: { in: slice } },
        data: { categoryId },
      });
      updated += r.count;
    }
  }
  return { updated };
}

/** Çözülebilen portföy logolarını DB’ye yazar. Aynı URL için updateMany. */
export async function backfillFundLogoUrls(client: PrismaClient): Promise<{ updated: number }> {
  const funds = await client.fund.findMany({
    where: { isActive: true },
    select: { id: true, name: true, logoUrl: true },
  });
  const byUrl = new Map<string, string[]>();
  for (const f of funds) {
    if (f.logoUrl?.trim()) continue;
    const resolved = resolveFundLogoUrl(null, f.name);
    if (!resolved) continue;
    const list = byUrl.get(resolved) ?? [];
    list.push(f.id);
    byUrl.set(resolved, list);
  }
  let updated = 0;
  for (const [logoUrl, ids] of byUrl) {
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const r = await client.fund.updateMany({
        where: { id: { in: slice } },
        data: { logoUrl },
      });
      updated += r.count;
    }
  }
  return { updated };
}

export async function runTefasMetadataPass(client: PrismaClient): Promise<{
  categoriesEnsured: number;
  categoriesAssigned: number;
  logosBackfilled: number;
}> {
  await ensureTefasFundCategories(client);
  const { updated: categoriesAssigned } = await assignFundCategoriesFromNames(client);
  const { updated: logosBackfilled } = await backfillFundLogoUrls(client);
  return {
    categoriesEnsured: TEFAS_CATEGORY_SEED.length,
    categoriesAssigned,
    logosBackfilled,
  };
}

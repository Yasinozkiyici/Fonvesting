import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseFundThemeParam, type FundThemeId } from "@/lib/fund-themes";
import type { ScoredFundRow } from "@/lib/services/fund-scores-types";
import { THEME_CLASSIFICATION_SOURCE } from "@/lib/services/fund-theme-classification";

export async function loadThemeTagsByFundCodes(codes: string[]): Promise<Map<string, FundThemeId[]>> {
  const normalized = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (normalized.length === 0) return new Map();
  const rows = await prisma.fundThemeTag.findMany({
    where: { fundCode: { in: normalized } },
    select: { fundCode: true, themeId: true },
  });
  const map = new Map<string, FundThemeId[]>();
  for (const r of rows) {
    const tid = parseFundThemeParam(r.themeId);
    if (!tid) continue;
    const k = r.fundCode.trim().toUpperCase();
    const cur = map.get(k) ?? [];
    cur.push(tid);
    map.set(k, cur);
  }
  return map;
}

export async function attachThemeTagsToScoredRows(rows: ScoredFundRow[]): Promise<ScoredFundRow[]> {
  if (rows.length === 0) return rows;
  const map = await loadThemeTagsByFundCodes(rows.map((r) => r.code));
  return rows.map((r) => {
    const fromDb = map.get(r.code.trim().toUpperCase());
    if (fromDb && fromDb.length > 0) return { ...r, themeTags: fromDb };
    return r;
  });
}

export async function syncFundThemeTagsInTransaction(
  tx: Prisma.TransactionClient,
  tagRows: Array<{ fundCode: string; themeId: FundThemeId }>
): Promise<void> {
  await tx.fundThemeTag.deleteMany({});
  const chunk = 2000;
  for (let i = 0; i < tagRows.length; i += chunk) {
    const slice = tagRows.slice(i, i + chunk).map((r) => ({
      fundCode: r.fundCode.trim().toUpperCase(),
      themeId: r.themeId,
      source: THEME_CLASSIFICATION_SOURCE,
    }));
    if (slice.length > 0) {
      await tx.fundThemeTag.createMany({ data: slice, skipDuplicates: true });
    }
  }
}

type TagRow = { fundCode: string; themeId: FundThemeId };

/** Tam tabloyu verilen sınıflandırma ile değiştirir (rebuild/backfill). */
export async function replaceAllFundThemeTags(tagRows: TagRow[]): Promise<{ written: number }> {
  await prisma.$transaction(async (tx) => {
    await syncFundThemeTagsInTransaction(tx, tagRows);
  });
  return { written: tagRows.length };
}

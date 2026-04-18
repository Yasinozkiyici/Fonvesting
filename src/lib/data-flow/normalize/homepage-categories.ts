/**
 * Ana sayfa kategori şeridi için tek normalizasyon sınırı.
 * Publishable: hem code hem name dolu ve trim sonrası boş değil.
 */
export type HomepageCategoryOption = { code: string; name: string };

export type NormalizeHomepageCategoriesResult = {
  categories: HomepageCategoryOption[];
  /** Geçersiz / eksik satır sayısı (telemetri). */
  rejectedRows: number;
};

export function normalizeHomepageCategoryList(
  raw: ReadonlyArray<{ code?: unknown; name?: unknown }> | null | undefined
): NormalizeHomepageCategoriesResult {
  const categories: HomepageCategoryOption[] = [];
  let rejectedRows = 0;
  for (const row of raw ?? []) {
    const code = typeof row.code === "string" ? row.code.trim() : String(row.code ?? "").trim();
    const name = typeof row.name === "string" ? row.name.trim() : String(row.name ?? "").trim();
    if (!code || !name) {
      rejectedRows += 1;
      continue;
    }
    categories.push({ code, name });
  }
  return { categories, rejectedRows };
}

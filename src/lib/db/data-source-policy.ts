/**
 * Okuma katmanı önceliği (scores/funds/compare/detail). Uygulama mantığı bu sırayı
 * route/service içinde uygular; burada yalnızca tek doğruluk kaydı olarak belgelenir.
 *
 * 1. `serving_*` tabloları (materialized read model, buildId ile hizalı)
 * 2. Dosya/cache artifact (ör. fund detail core serving dosya cache’i)
 * 3. `ScoresApiCache` / persisted cache satırları
 * 4. Canlı Prisma sorguları (snapshot, history) — timeout ve maliyet kontrollü
 *
 * Prisma runtime bağlantısı **yalnızca** DATABASE_URL üzerinden kurulur (DIRECT_URL değil).
 */
export const READ_SIDE_SOURCE_ORDER = [
  "serving_tables",
  "file_artifact_cache",
  "persisted_row_cache",
  "live_prisma_queries",
] as const;

export type ReadSideSourceLayer = (typeof READ_SIDE_SOURCE_ORDER)[number];

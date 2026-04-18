/**
 * Serving listesi satırlarında eksik/bozuk `code` alanı ana sayfa SSR'ında `trim()` ile runtime patlamasın.
 * (Prisma içermez — unit test güvenli.)
 */
export function servingHomeRowHasPublishableCode(row: { code?: string | null }): boolean {
  return String(row.code ?? "").trim().length > 0;
}

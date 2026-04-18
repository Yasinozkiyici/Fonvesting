/** Fon kimliği ve kod normalizasyonu — hesaplamalar buraya taşınacak. */
export function normalizeFundCode(code: string): string {
  return code.trim().toUpperCase();
}

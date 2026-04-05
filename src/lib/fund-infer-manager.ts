/**
 * TEFAS fon tam unvanından portföy yöneticisi satırını çıkarır (veritabanında ayrı alan yok).
 * "… YATIRIM FONU" öncesini alır; eşleşmezse null.
 */
export function inferPortfolioManagerFromFundName(fundName: string): string | null {
  const n = fundName.trim();
  if (n.length < 6) return null;
  const lower = n.toLowerCase();
  const idx = lower.lastIndexOf(" yatırım fonu");
  if (idx <= 0) {
    const idx2 = lower.lastIndexOf(" yatirim fonu");
    if (idx2 <= 0) return null;
    const prefix = n.slice(0, idx2).trim();
    return prefix.length >= 3 ? prefix : null;
  }
  const prefix = n.slice(0, idx).trim();
  return prefix.length >= 3 ? prefix : null;
}

export function formatCompactNumber(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("tr-TR");
}

export function formatCompactCurrency(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000_000) return `₺${(n / 1_000_000_000_000).toFixed(1)}Tn`;
  if (n >= 1_000_000_000) return `₺${(n / 1_000_000_000).toFixed(1)}Mr`;
  if (n >= 1_000_000) return `₺${(n / 1_000_000).toFixed(1)}Mn`;
  if (n >= 1_000) return `₺${(n / 1_000).toFixed(1)}K`;
  return `₺${n.toLocaleString("tr-TR")}`;
}

export function fundDisplaySubtitle(fund: { code: string; name: string; shortName: string | null }): string {
  return (fund.shortName && fund.shortName !== fund.code ? fund.shortName : fund.name).trim();
}

/** Birim fiyat (son fiyat) — tablo hücresi */
export function formatFundLastPrice(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "—";
  return v.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

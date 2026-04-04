/** 7G: sparkline ilk–son nokta yüzde değişimi (tek sefer hesap, önbellek anahtarı için). */
export function sparklinePeriodReturnPct(data: number[] | null | undefined): number | null {
  if (!data || data.length < 2) return null;
  const first = data.at(0);
  const last = data.at(-1);
  if (first === undefined || last === undefined) return null;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return ((last - first) / first) * 100;
}

/** Tüm fonlar için 7G yüzdesi — client’ta satır başına tekrar hesaplamayı önler. */
export function buildSevenDayPctMap(funds: { fundId: string; sparkline: number[] }[]): Map<string, number | null> {
  const m = new Map<string, number | null>();
  for (const f of funds) {
    m.set(f.fundId, sparklinePeriodReturnPct(f.sparkline));
  }
  return m;
}

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

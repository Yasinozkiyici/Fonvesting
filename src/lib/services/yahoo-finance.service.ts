/**
 * TEFAS odaklı projede BIST/Yahoo entegrasyonu kullanılmıyor.
 * Eski API yolları için boş sonuç dönülür (sparkline vb.).
 */
export type YahooBistQuote = {
  symbol: string;
  yahooSymbol: string;
  shortName: string | null;
  longName: string | null;
  trailingPE: number | null;
  regularMarketPrice: number | null;
  regularMarketChangePercent: number | null;
  marketCap: number | null;
  regularMarketVolume: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
};

export async function fetchBistQuotes(_symbols: readonly string[]): Promise<Record<string, YahooBistQuote>> {
  return {};
}

export async function fetchBistSparklines(
  _symbols: readonly string[]
): Promise<Record<string, { points: number[]; trend: "up" | "down" | "flat" }>> {
  return {};
}

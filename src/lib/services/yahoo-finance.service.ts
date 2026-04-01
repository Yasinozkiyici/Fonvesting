import YahooFinance from "yahoo-finance2";
import { buildBistYahooSymbols, toBistBaseSymbol } from "@/lib/services/bist-symbols";

type YahooBistQuote = {
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

const yahooFinance = new YahooFinance({
  quoteCombine: {
    maxSymbolsPerRequest: 40,
    debounceTime: 40,
  },
});

const QUOTE_FIELDS = [
  "symbol",
  "shortName",
  "longName",
  "trailingPE",
  "regularMarketPrice",
  "regularMarketChangePercent",
  "marketCap",
  "regularMarketVolume",
  "fiftyTwoWeekHigh",
  "fiftyTwoWeekLow",
] as const;

const BATCH_SIZE = 40;
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { expiresAt: number; data: Record<string, YahooBistQuote> }>();
const SPARKLINE_CACHE_TTL_MS = 30 * 60 * 1000;
const sparklineCache = new Map<
  string,
  { expiresAt: number; data: Record<string, { points: number[]; trend: "up" | "down" | "flat" }> }
>();

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cacheKey(symbols: string[]): string {
  return symbols.slice().sort().join(",");
}

function fromCache(symbols: string[]): Record<string, YahooBistQuote> | null {
  const key = cacheKey(symbols);
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function saveCache(symbols: string[], data: Record<string, YahooBistQuote>) {
  cache.set(cacheKey(symbols), { expiresAt: Date.now() + CACHE_TTL_MS, data });
}

function fromSparklineCache(symbols: string[]) {
  const key = cacheKey(symbols);
  const hit = sparklineCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    sparklineCache.delete(key);
    return null;
  }
  return hit.data;
}

function saveSparklineCache(
  symbols: string[],
  data: Record<string, { points: number[]; trend: "up" | "down" | "flat" }>
) {
  sparklineCache.set(cacheKey(symbols), { expiresAt: Date.now() + SPARKLINE_CACHE_TTL_MS, data });
}

export async function fetchBistQuotes(symbols: readonly string[]): Promise<Record<string, YahooBistQuote>> {
  const yahooSymbols = buildBistYahooSymbols(symbols);
  if (yahooSymbols.length === 0) return {};

  const cached = fromCache(yahooSymbols);
  if (cached) return cached;

  const result: Record<string, YahooBistQuote> = {};
  const symbolBatches = chunk(yahooSymbols, BATCH_SIZE);

  await Promise.all(
    symbolBatches.map(async (batch) => {
      try {
        const quotes = await yahooFinance.quote(batch, {
          return: "array",
          fields: [...QUOTE_FIELDS],
        });

        for (const q of quotes) {
          const yahooSymbol = String(q.symbol || "").toUpperCase();
          if (!yahooSymbol) continue;
          const symbol = toBistBaseSymbol(yahooSymbol);

          result[symbol] = {
            symbol,
            yahooSymbol,
            shortName: typeof q.shortName === "string" ? q.shortName : null,
            longName: typeof q.longName === "string" ? q.longName : null,
            trailingPE: toNullableNumber(q.trailingPE),
            regularMarketPrice: toNullableNumber(q.regularMarketPrice),
            regularMarketChangePercent: toNullableNumber(q.regularMarketChangePercent),
            marketCap: toNullableNumber(q.marketCap),
            regularMarketVolume: toNullableNumber(q.regularMarketVolume),
            fiftyTwoWeekHigh: toNullableNumber(q.fiftyTwoWeekHigh),
            fiftyTwoWeekLow: toNullableNumber(q.fiftyTwoWeekLow),
          };
        }
      } catch (error) {
        // Batch bazlı hata yutulur, API ayakta kalır.
        console.error("Yahoo batch fetch failed:", batch, error);
      }
    })
  );

  saveCache(yahooSymbols, result);
  return result;
}

export async function fetchBistSparklines(
  symbols: readonly string[]
): Promise<Record<string, { points: number[]; trend: "up" | "down" | "flat" }>> {
  const yahooSymbols = buildBistYahooSymbols(symbols);
  if (yahooSymbols.length === 0) return {};

  const cached = fromSparklineCache(yahooSymbols);
  if (cached) return cached;

  const result: Record<string, { points: number[]; trend: "up" | "down" | "flat" }> = {};
  const batches = chunk(yahooSymbols, 10);

  for (const batch of batches) {
    await Promise.all(
      batch.map(async (yahooSymbol) => {
        try {
          const period2 = new Date();
          const period1 = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
          const chart = await yahooFinance.chart(yahooSymbol, {
            period1,
            period2,
            interval: "1d",
          });
          const closes = Array.isArray(chart?.quotes)
            ? chart.quotes
                .map((q: { close?: number }) => q?.close)
                .filter((n: unknown): n is number => typeof n === "number" && Number.isFinite(n))
            : [];

          if (closes.length >= 2) {
            const symbol = toBistBaseSymbol(yahooSymbol);
            const first = closes[0];
            const last = closes[closes.length - 1];
            const trend: "up" | "down" | "flat" = last > first ? "up" : last < first ? "down" : "flat";
            result[symbol] = { points: closes, trend };
          }
        } catch (error) {
          console.error("Yahoo sparkline fetch failed:", yahooSymbol, error);
        }
      })
    );
  }

  saveSparklineCache(yahooSymbols, result);
  return result;
}

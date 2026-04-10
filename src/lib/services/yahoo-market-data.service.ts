import { startOfUtcDay } from "@/lib/trading-calendar-tr";

export type YahooDailyPoint = {
  date: Date;
  value: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  currency: string | null;
};

type YahooChartQuote = {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
  volume?: Array<number | null>;
};

type YahooChartAdjClose = {
  adjclose?: Array<number | null>;
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string;
        symbol?: string;
        shortName?: string;
        longName?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: YahooChartQuote[];
        adjclose?: YahooChartAdjClose[];
      };
    }>;
    error?: { code?: string; description?: string } | null;
  };
};

const YAHOO_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberOrNull(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? Number(value) : null;
}

function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function normalizeYahooSessionDate(timestampSec: number): Date {
  return startOfUtcDay(new Date(timestampSec * 1000));
}

export async function fetchYahooDailySeries(symbol: string, startDate: Date, endDate: Date): Promise<YahooDailyPoint[]> {
  const period1 = toUnixSeconds(startOfUtcDay(startDate));
  const period2 = toUnixSeconds(new Date(startOfUtcDay(endDate).getTime() + DAY_MS));
  const url =
    `${YAHOO_BASE_URL}/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false&events=div%2Csplits`;

  let text = "";
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0",
        },
        cache: "no-store",
      });

      text = await response.text();
      if (!response.ok) {
        throw new Error(`Yahoo chart HTTP ${response.status} (${symbol})`);
      }
      if (/Too Many Requests/i.test(text)) {
        throw new Error(`Yahoo chart throttled (${symbol})`);
      }
      lastError = null;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= MAX_RETRIES) break;
      await sleep(250 * attempt);
    }
  }

  if (lastError) {
    throw lastError;
  }

  let payload: YahooChartResponse;
  try {
    payload = JSON.parse(text) as YahooChartResponse;
  } catch {
    throw new Error(`Yahoo chart invalid JSON (${symbol})`);
  }

  const error = payload.chart?.error;
  if (error) {
    throw new Error(`Yahoo chart failed (${symbol}): ${error.code ?? "unknown"} ${error.description ?? ""}`.trim());
  }

  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  const adjclose = result?.indicators?.adjclose?.[0]?.adjclose ?? [];
  const currency = result?.meta?.currency ?? null;

  const points = new Map<number, YahooDailyPoint>();

  for (let i = 0; i < timestamps.length; i += 1) {
    const timestamp = timestamps[i];
    if (timestamp == null || !Number.isFinite(timestamp)) continue;

    const close = numberOrNull(quote?.close?.[i]);
    const adjustedClose = numberOrNull(adjclose[i]);
    const value = adjustedClose ?? close;
    if (value == null || value <= 0) continue;

    const date = normalizeYahooSessionDate(timestamp);
    points.set(date.getTime(), {
      date,
      value,
      open: numberOrNull(quote?.open?.[i]),
      high: numberOrNull(quote?.high?.[i]),
      low: numberOrNull(quote?.low?.[i]),
      volume: numberOrNull(quote?.volume?.[i]),
      currency,
    });
  }

  return [...points.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

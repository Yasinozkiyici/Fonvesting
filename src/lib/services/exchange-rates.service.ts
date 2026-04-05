import { unstable_cache } from "next/cache";

/**
 * USD/TRY ve türev EUR/TRY (USD üzerinden) — open.er-api.com.
 * Üretimde piyasa özetinde kur görünmesi için DB boşsa önbellekli fallback.
 */
export async function fetchUsdTryEurTryLive(): Promise<{ usdTry: number; eurTry: number } | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: string;
      rates?: { TRY?: number; EUR?: number };
    };
    if (data.result !== "success" || !data.rates) return null;
    const usdTry = Number(data.rates.TRY);
    const eurUsd = Number(data.rates.EUR);
    if (!Number.isFinite(usdTry) || usdTry <= 0) return null;
    const eurTry = Number.isFinite(eurUsd) && eurUsd > 0 ? usdTry / eurUsd : usdTry / 0.92;
    return { usdTry, eurTry };
  } catch {
    return null;
  }
}

const getCachedRates = unstable_cache(
  async () => fetchUsdTryEurTryLive(),
  ["fx-usd-try-v1"],
  { revalidate: 900 }
);

/** Kısa ömürlü önbellek — sıcak yol ve API yükünü sınırlar */
export async function getCachedUsdTryEurTry(): Promise<{ usdTry: number; eurTry: number } | null> {
  return getCachedRates();
}

export function mergeSnapshotFx(
  dbUsd: number | null | undefined,
  dbEur: number | null | undefined,
  live: { usdTry: number; eurTry: number } | null
): { usdTry: number | null; eurTry: number | null } {
  return {
    usdTry: dbUsd != null && Number.isFinite(dbUsd) ? dbUsd : live?.usdTry ?? null,
    eurTry: dbEur != null && Number.isFinite(dbEur) ? dbEur : live?.eurTry ?? null,
  };
}

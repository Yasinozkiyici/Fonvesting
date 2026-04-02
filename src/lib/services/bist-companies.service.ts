type BistCompany = {
  symbol: string;
  name: string;
  logoUrl: string | null;
};

type RemoteCompany = {
  symbol?: string;
  name?: string;
};

const BIST_LIST_URL =
  "https://cdn.jsdelivr.net/gh/ahmeterenodaci/Istanbul-Stock-Exchange--BIST--including-symbols-and-logos/without_logo.json";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
let cache: { expiresAt: number; data: BistCompany[] } | null = null;

function normalizeSymbol(symbol: string) {
  const clean = symbol.trim().toUpperCase().replace(/\.IS$/, "");
  return clean;
}

export async function fetchAllBistCompanies(): Promise<BistCompany[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.data;

  const response = await fetch(BIST_LIST_URL, {
    headers: { Accept: "application/json" },
    next: { revalidate: 86_400 },
  });

  if (!response.ok) {
    throw new Error(`BIST list fetch failed: ${response.status}`);
  }

  const raw = (await response.json()) as RemoteCompany[];
  const data = raw
    .filter((item) => item?.symbol && item?.name)
    .map((item) => {
      const symbol = normalizeSymbol(item.symbol!);
      return {
        symbol,
        name: item.name!.trim(),
        logoUrl: `https://cdn.jsdelivr.net/gh/ahmeterenodaci/Istanbul-Stock-Exchange--BIST--including-symbols-and-logos/logos/${symbol}.png`,
      };
    });

  cache = {
    expiresAt: Date.now() + ONE_DAY_MS,
    data,
  };

  return data;
}

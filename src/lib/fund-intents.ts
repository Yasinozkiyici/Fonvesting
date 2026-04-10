import type { RankingMode } from "@/lib/scoring";

export type FundIntentId = "balanced" | "growth" | "cash_park" | "bes_start" | "low_volatility";

export type FundIntentDef = {
  id: FundIntentId;
  label: string;
  shortHint: string;
  preferredMode: RankingMode;
  /** Bazı intent'ler için kategori kodu hedefi (ör. PPF). */
  preferredCategoryCode?: string;
  /** Kategori kodu sabit değilse, isim üstünden eşleştirme. */
  categoryNameIncludes?: string[];
};

export const FUND_INTENTS: FundIntentDef[] = [
  {
    id: "balanced",
    label: "Dengeli",
    shortHint: "Daha dengeli sıralama",
    preferredMode: "STABLE",
  },
  {
    id: "growth",
    label: "Büyüme",
    shortHint: "Getiri odağı",
    preferredMode: "HIGH_RETURN",
  },
  {
    id: "cash_park",
    label: "Likit",
    shortHint: "Kısa vade park",
    preferredMode: "STABLE",
    preferredCategoryCode: "PPF",
  },
  {
    id: "bes_start",
    label: "BES",
    shortHint: "BES başlangıç görünümü",
    preferredMode: "BEST",
    categoryNameIncludes: ["emeklilik", "bes"],
  },
  {
    id: "low_volatility",
    label: "Sakin",
    shortHint: "Daha düşük oynaklık",
    preferredMode: "LOW_RISK",
  },
];

export function parseFundIntentParam(raw: string): FundIntentId | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (key === "balanced") return "balanced";
  if (key === "growth") return "growth";
  if (key === "cash_park") return "cash_park";
  if (key === "bes_start") return "bes_start";
  if (key === "low_volatility") return "low_volatility";
  return null;
}

export function getFundIntent(id: FundIntentId | null): FundIntentDef | null {
  if (!id) return null;
  return FUND_INTENTS.find((x) => x.id === id) ?? null;
}

export function resolveFundIntentCategory(
  intentId: FundIntentId | null,
  categories: Array<{ code: string; name: string }>
): string {
  const intent = getFundIntent(intentId);
  if (!intent) return "";
  if (intent.preferredCategoryCode) {
    const hit = categories.find((category) => category.code === intent.preferredCategoryCode);
    if (hit) return hit.code;
  }
  if (intent.categoryNameIncludes && intent.categoryNameIncludes.length > 0) {
    const hit = categories.find((category) =>
      intent.categoryNameIncludes!.some((token) =>
        category.name.toLocaleLowerCase("tr-TR").includes(token.toLocaleLowerCase("tr-TR"))
      )
    );
    if (hit) return hit.code;
  }
  return "";
}

export function resolveFundIntentState(
  intentId: FundIntentId | null,
  categories: Array<{ code: string; name: string }>,
  fallback: { mode: RankingMode; category: string }
): { mode: RankingMode; category: string } {
  const intent = getFundIntent(intentId);
  if (!intent) return fallback;
  return {
    mode: intent.preferredMode,
    category: resolveFundIntentCategory(intentId, categories),
  };
}

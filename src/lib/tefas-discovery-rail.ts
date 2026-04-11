import type { FundThemeId } from "@/lib/fund-themes";
import { getFundTheme } from "@/lib/fund-themes";

export type DiscoveryPrimaryKind = "balanced" | "growth" | "defensive" | "cash" | "thematic" | "categories";

export type DiscoverySecondaryDef = {
  id: string;
  label: string;
  /** Kategori adında aranacak ipuçları (sırayla dener, ilk eşleşen kod) */
  categoryHints?: string[];
  themeId?: FundThemeId | null;
};

/** Tematik rail sırası: kart altı copy ile uyumlu, önce somut temalar */
const THEMATIC_RAIL_ORDER: FundThemeId[] = [
  "blockchain",
  "green_energy",
  "technology",
  "health_biotech",
  "artificial_intelligence",
  "precious_metals",
  "defense",
];

export function thematicRailOptions(): DiscoverySecondaryDef[] {
  return THEMATIC_RAIL_ORDER.map((id) => {
    const t = getFundTheme(id);
    return { id, label: t?.label ?? id, themeId: id };
  });
}

const BALANCED: DiscoverySecondaryDef[] = [
  { id: "bal-wide", label: "Geniş dağılım", categoryHints: ["değişken"] },
  { id: "bal-vol", label: "Kontrollü oynaklık", categoryHints: ["karma"] },
  { id: "bal-mid", label: "Orta risk", categoryHints: ["serbest"] },
  { id: "bal-mix", label: "Karma yapı", categoryHints: ["fon sepeti", "sepet", "multi"] },
  { id: "bal-part", label: "Dengeli katılım", categoryHints: ["katılım"] },
  { id: "bal-multi", label: "Çoklu varlık", categoryHints: ["karma", "değişken"] },
];

const GROWTH: DiscoverySecondaryDef[] = [
  { id: "gr-long", label: "Uzun vade", categoryHints: ["hisse"] },
  { id: "gr-pot", label: "Yüksek potansiyel", categoryHints: ["değişken"] },
  { id: "gr-eq", label: "Hisse ağırlıklı", categoryHints: ["hisse senet", "hisse"] },
  { id: "gr-agg", label: "Agresif büyüme", categoryHints: ["serbest"] },
  { id: "gr-mom", label: "Momentum odaklı", categoryHints: ["değişken", "serbest"] },
  { id: "gr-tech", label: "Teknoloji büyümesi", categoryHints: ["hisse"], themeId: "technology" },
];

const DEFENSIVE: DiscoverySecondaryDef[] = [
  { id: "def-low", label: "Düşük oynaklık", categoryHints: ["para piyasası"] },
  { id: "def-short", label: "Kısa vade", categoryHints: ["kısa vadeli", "para piyasası"] },
  { id: "def-guard", label: "Koruma odaklı", categoryHints: ["borçlanma"] },
  { id: "def-cashlike", label: "Nakit benzeri", categoryHints: ["para piyasası", "bilye"] },
  { id: "def-mix", label: "Defansif dağılım", categoryHints: ["karma"] },
  { id: "def-ctrl", label: "Kontrollü görünüm", categoryHints: ["serbest"] },
];

const CASH: DiscoverySecondaryDef[] = [
  { id: "cash-ppf", label: "Para piyasası", categoryHints: ["para piyasası"] },
  { id: "cash-tl", label: "Kısa vade TL", categoryHints: ["kısa vadeli"] },
  { id: "cash-fx", label: "Kısa vade döviz", categoryHints: ["döviz", "kur korumalı"] },
  { id: "cash-liq", label: "Likit", categoryHints: ["para piyasası", "serbest"] },
  { id: "cash-low", label: "Düşük risk", categoryHints: ["para piyasası", "borçlanma"] },
  { id: "cash-park", label: "Günlük park", categoryHints: ["para piyasası"] },
];

export const DISCOVERY_SECONDARY_BY_PRIMARY: Record<
  DiscoveryPrimaryKind,
  DiscoverySecondaryDef[] | "from_categories" | "from_themes"
> = {
  balanced: BALANCED,
  growth: GROWTH,
  defensive: DEFENSIVE,
  cash: CASH,
  thematic: "from_themes",
  categories: "from_categories",
};

function normalizeTr(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]+/g, "");
}

/** Kategori listesinde ipuçlarına göre ilk uygun kodu bulur */
export function resolveCategoryCodeByHints(
  categories: Array<{ code: string; name: string }>,
  hints: string[] | undefined
): string {
  if (!hints?.length) return "";
  for (const hint of hints) {
    const h = normalizeTr(hint.trim());
    if (!h) continue;
    const hit = categories.find((c) => normalizeTr(c.name).includes(h));
    if (hit) return hit.code;
  }
  return "";
}

export function secondaryOptionsForPrimary(
  primary: DiscoveryPrimaryKind,
  categories: Array<{ code: string; name: string }>
): DiscoverySecondaryDef[] {
  const spec = DISCOVERY_SECONDARY_BY_PRIMARY[primary];
  if (spec === "from_categories") {
    return categories.map((c) => ({ id: c.code, label: c.name, categoryHints: [c.name] }));
  }
  if (spec === "from_themes") {
    return thematicRailOptions();
  }
  return spec;
}

export function defaultSecondaryId(primary: DiscoveryPrimaryKind, categories: Array<{ code: string; name: string }>): string {
  const opts = secondaryOptionsForPrimary(primary, categories);
  return opts[0]?.id ?? "";
}

export function findSecondaryDef(
  primary: DiscoveryPrimaryKind,
  secondaryId: string,
  categories: Array<{ code: string; name: string }>
): DiscoverySecondaryDef | null {
  const opts = secondaryOptionsForPrimary(primary, categories);
  return opts.find((o) => o.id === secondaryId) ?? null;
}

export type ResolvedDiscoveryFilters = {
  categoryCode: string;
  themeId: FundThemeId | null;
  secondaryLabel: string;
};

export function resolveDiscoveryFilters(
  primary: DiscoveryPrimaryKind,
  secondaryId: string,
  categories: Array<{ code: string; name: string }>
): ResolvedDiscoveryFilters {
  const def = findSecondaryDef(primary, secondaryId, categories);
  if (!def) {
    return { categoryCode: "", themeId: null, secondaryLabel: "" };
  }
  if (primary === "thematic") {
    const tid = (def.themeId ?? def.id) as FundThemeId;
    return {
      categoryCode: "",
      themeId: tid,
      secondaryLabel: getFundTheme(tid)?.label ?? def.label,
    };
  }
  if (primary === "categories") {
    return {
      categoryCode: def.id,
      themeId: null,
      secondaryLabel: def.label,
    };
  }
  const code = resolveCategoryCodeByHints(categories, def.categoryHints);
  return {
    categoryCode: code,
    themeId: def.themeId ?? null,
    secondaryLabel: def.label,
  };
}

export function railStepTitle(primary: DiscoveryPrimaryKind): string {
  switch (primary) {
    case "balanced":
      return "İkinci adım — dengeli karakter";
    case "growth":
      return "İkinci adım — büyüme odağı";
    case "defensive":
      return "İkinci adım — savunmacı profil";
    case "cash":
      return "İkinci adım — likidite ve vade";
    case "thematic":
      return "İkinci adım — alt tema";
    case "categories":
      return "İkinci adım — fon sınıfı / kategori";
    default:
      return "İkinci adım";
  }
}

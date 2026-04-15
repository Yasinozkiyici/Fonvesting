import type { ScoredFund } from "@/types/scored-funds";

export type FundThemeId =
  | "technology"
  | "artificial_intelligence"
  | "green_energy"
  | "blockchain"
  | "precious_metals"
  | "defense"
  | "health_biotech";

export type FundThemeDef = {
  id: FundThemeId;
  label: string;
  shortHint: string;
  matchTokens: string[];
};

export const FUND_THEMES: FundThemeDef[] = [
  {
    id: "technology",
    label: "Teknoloji",
    shortHint: "Teknoloji ve dijital altyapı odağı",
    matchTokens: [
      "teknoloji",
      "teknolojiler",
      "technology",
      "dijital",
      "digital",
      "iletisim",
      "communication",
      "yarı iletken",
      "semiconductor",
      "robotik",
    ],
  },
  {
    id: "artificial_intelligence",
    label: "Yapay Zekâ",
    shortHint: "YZ, robotik ve otomasyon temaları",
    matchTokens: [
      "yapay zeka",
      "artificial intelligence",
      "ai",
      "robot",
      "robotik",
      "robotics",
      "automation",
      "otonom",
      "yarı iletken",
    ],
  },
  {
    id: "green_energy",
    label: "Yeşil Enerji",
    shortHint: "Temiz enerji ve sürdürülebilir dönüşüm",
    matchTokens: [
      "enerji",
      "temiz enerji",
      "alternatif enerji",
      "clean energy",
      "yenilenebilir",
      "renewable",
      "solar",
      "gunes",
      "ruzgar",
      "wind",
      "surdurulebilir",
      "sustainability",
    ],
  },
  {
    id: "blockchain",
    label: "Blockchain",
    shortHint: "Blokzincir ve dijital varlık altyapıları",
    matchTokens: [
      "blockchain",
      "blokzincir",
      "blokzinciri",
      "blok zincir",
      "blok zinciri",
      "fintek",
      "kripto",
      "crypto",
      "bitcoin",
      "ethereum",
      "digital asset",
      "dijital varlik",
    ],
  },
  {
    id: "precious_metals",
    label: "Altın / Gümüş",
    shortHint: "Değerli metal odaklı fonlar",
    matchTokens: ["altin", "gold", "gumus", "silver", "kiymetli maden", "precious metal"],
  },
  {
    id: "defense",
    label: "Savunma",
    shortHint: "Savunma, havacılık ve güvenlik ekseni",
    matchTokens: ["savunma", "savunma sanayii", "defense", "guvenlik", "security", "havacilik", "aerospace", "uzay", "space"],
  },
  {
    id: "health_biotech",
    label: "Sağlık / Biyoteknoloji",
    shortHint: "Sağlık, ilaç ve biyoteknoloji temaları",
    matchTokens: ["saglik", "health", "healthcare", "biyoteknoloji", "biotech", "ilac", "pharma", "genom", "genetic"],
  },
];

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]+/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripInstitutionPrefix(value: string): string {
  const text = normalizeText(value);
  if (!text) return "";

  for (const marker of [" portfoy ", " a s "]) {
    const idx = text.indexOf(marker);
    if (idx > 0 && idx <= 64) {
      const stripped = text.slice(idx + marker.length).trim();
      if (stripped) return stripped;
    }
  }

  return text;
}

function tokenMatchesText(text: string, token: string): boolean {
  const words = text.split(" ").filter(Boolean);
  const tokenWords = normalizeText(token).split(" ").filter(Boolean);
  if (tokenWords.length === 0 || words.length < tokenWords.length) return false;

  outer: for (let start = 0; start <= words.length - tokenWords.length; start += 1) {
    for (let offset = 0; offset < tokenWords.length; offset += 1) {
      if (words[start + offset] !== tokenWords[offset]) continue outer;
    }
    return true;
  }

  return false;
}

export function parseFundThemeParam(raw: string): FundThemeId | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (key === "technology") return "technology";
  if (key === "artificial_intelligence") return "artificial_intelligence";
  if (key === "green_energy") return "green_energy";
  if (key === "blockchain") return "blockchain";
  if (key === "precious_metals") return "precious_metals";
  if (key === "defense") return "defense";
  if (key === "health_biotech") return "health_biotech";
  return null;
}

export function getFundTheme(id: FundThemeId | null): FundThemeDef | null {
  if (!id) return null;
  return FUND_THEMES.find((item) => item.id === id) ?? null;
}

export function fundMatchesTheme(fund: ScoredFund, themeId: FundThemeId | null): boolean {
  const theme = getFundTheme(themeId);
  if (!theme) return true;

  const nameText = stripInstitutionPrefix(fund.name);
  const shortText = fund.shortName ? stripInstitutionPrefix(fund.shortName) : "";
  const searchText = [nameText, shortText].filter(Boolean).join(" ").trim();
  if (!searchText) return false;

  return theme.matchTokens.some((token) => tokenMatchesText(searchText, token));
}

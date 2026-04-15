import { prisma } from "@/lib/prisma";
import { fetchSupabaseRestJson, hasSupabaseRestConfig } from "@/lib/supabase-rest";
import { buildFundCodeInClause } from "@/lib/services/fund-registry-read.util";

const FUND_REGISTRY_READ_TIMEOUT_MS = Number(process.env.FUND_REGISTRY_READ_TIMEOUT_MS ?? "1800");

type RegistryRow = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  lastPrice: number;
  dailyReturn: number;
  portfolioSize: number;
  investorCount: number;
};

async function readRegistryRowsFromRest(codes: string[]): Promise<RegistryRow[]> {
  if (!hasSupabaseRestConfig() || codes.length === 0) return [];
  const inClause = buildFundCodeInClause(codes);
  const rows = await fetchSupabaseRestJson<RegistryRow[]>(
    `Fund?select=id,code,name,shortName,logoUrl,lastPrice,dailyReturn,portfolioSize,investorCount&isActive=eq.true&code=in.${inClause}&limit=200`,
    {
      timeoutMs: FUND_REGISTRY_READ_TIMEOUT_MS,
      retries: 0,
      revalidate: 30,
    }
  );
  return rows ?? [];
}

async function readRegistryRowsFromPrisma(codes: string[]): Promise<RegistryRow[]> {
  if (codes.length === 0) return [];
  const rows = await prisma.fund.findMany({
    where: {
      code: { in: codes },
      isActive: true,
    },
    select: {
      id: true,
      code: true,
      name: true,
      shortName: true,
      logoUrl: true,
      lastPrice: true,
      dailyReturn: true,
      portfolioSize: true,
      investorCount: true,
    },
  });
  return rows;
}

export async function readActiveRegistryFundsByCodes(codes: string[]): Promise<RegistryRow[]> {
  const normalizedCodes = [...new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
  if (normalizedCodes.length === 0) return [];
  try {
    const restRows = await readRegistryRowsFromRest(normalizedCodes);
    if (restRows.length > 0) return restRows;
  } catch {
    // REST read yolu başarısızsa Prisma fallback denenir.
  }
  return readRegistryRowsFromPrisma(normalizedCodes);
}

export async function readActiveRegistryFundByCode(code: string): Promise<RegistryRow | null> {
  const rows = await readActiveRegistryFundsByCodes([code]);
  const normalized = code.trim().toUpperCase();
  return rows.find((row) => row.code.trim().toUpperCase() === normalized) ?? null;
}

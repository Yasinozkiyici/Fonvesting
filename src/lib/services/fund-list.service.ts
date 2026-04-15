import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { LIVE_DATA_CACHE_SEC } from "@/lib/data-freshness";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import { fundTypeForApi } from "@/lib/fund-type-display";
import {
  fetchSupabaseRestJson,
  fetchSupabaseRestResponse,
  hasSupabaseRestConfig,
} from "@/lib/supabase-rest";

export interface FundListRow {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  portfolioSize: number;
  lastPrice: number;
  dailyReturn: number;
  weeklyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  investorCount: number;
  shareCount: number;
  category: { code: string; name: string; color: string | null } | null;
  fundType: { code: number; name: string } | null;
}

export interface FundListCategoryOption {
  code: string;
  name: string;
}

export interface FundListTypeOption {
  code: number;
  name: string;
}

export type FundListSortField =
  | "portfolioSize"
  | "dailyReturn"
  | "lastPrice"
  | "investorCount"
  | "weeklyReturn"
  | "monthlyReturn"
  | "yearlyReturn";

export type FundListSortDir = "asc" | "desc";

export interface FundListQueryInput {
  page: number;
  pageSize: number;
  q?: string;
  category?: string;
  fundType?: string;
  sortField: FundListSortField;
  sortDir: FundListSortDir;
}

export interface FundListPageResult {
  items: FundListRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  source?: "rest" | "prisma";
}

type SupabaseSnapshotDateRow = { date: string };
type SupabaseFundSnapshotRow = {
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  portfolioSize: number;
  investorCount: number;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  categoryCode: string | null;
  categoryName: string | null;
  fundTypeCode: number | null;
  fundTypeName: string | null;
};

const SUPABASE_SORT_FIELD_MAP: Record<FundListSortField, string> = {
  portfolioSize: "portfolioSize",
  dailyReturn: "dailyReturn",
  lastPrice: "lastPrice",
  investorCount: "investorCount",
  weeklyReturn: "portfolioSize",
  monthlyReturn: "monthlyReturn",
  yearlyReturn: "yearlyReturn",
};

function normalizeRestFundRow(row: SupabaseFundSnapshotRow): FundListRow {
  const fundType =
    row.fundTypeCode != null && row.fundTypeName
      ? fundTypeForApi({ code: row.fundTypeCode, name: row.fundTypeName })
      : null;

  return {
    id: row.fundId,
    code: row.code,
    name: row.name,
    shortName: row.shortName,
    logoUrl: getFundLogoUrlForUi(row.fundId, row.code, row.logoUrl, row.name),
    portfolioSize: row.portfolioSize,
    lastPrice: row.lastPrice,
    dailyReturn: row.dailyReturn,
    weeklyReturn: 0,
    monthlyReturn: row.monthlyReturn,
    yearlyReturn: row.yearlyReturn,
    investorCount: row.investorCount,
    shareCount: 0,
    category:
      row.categoryCode && row.categoryName
        ? { code: row.categoryCode, name: row.categoryName, color: null }
        : null,
    fundType,
  };
}

function buildFilterOptionsFromItems(items: FundListRow[]): {
  categories: FundListCategoryOption[];
  fundTypes: FundListTypeOption[];
} {
  const categories = Array.from(
    new Map(
      items
        .filter((item): item is FundListRow & { category: NonNullable<FundListRow["category"]> } => item.category != null)
        .map((item) => [item.category.code, { code: item.category.code, name: item.category.name }])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name, "tr", { sensitivity: "base" }));

  const fundTypes = Array.from(
    new Map(
      items
        .filter((item): item is FundListRow & { fundType: NonNullable<FundListRow["fundType"]> } => item.fundType != null)
        .map((item) => [item.fundType.code, { code: item.fundType.code, name: item.fundType.name }])
    ).values()
  ).sort((a, b) => a.code - b.code);

  return { categories, fundTypes };
}

async function computeAllFundsFromLatestSnapshotFromSupabaseRest(): Promise<FundListRow[]> {
  if (!hasSupabaseRestConfig()) {
    throw new Error("supabase_rest_not_configured");
  }

  const latestRows = await fetchSupabaseRestJson<SupabaseSnapshotDateRow[]>(
    "FundDailySnapshot?select=date&order=date.desc&limit=1",
    { revalidate: LIVE_DATA_CACHE_SEC, timeoutMs: 1_500, retries: 0 }
  );
  const latestDate = latestRows[0]?.date;
  if (!latestDate) return [];

  const query = new URLSearchParams({
    select:
      "fundId,code,name,shortName,logoUrl,portfolioSize,investorCount,lastPrice,dailyReturn,monthlyReturn,yearlyReturn,categoryCode,categoryName,fundTypeCode,fundTypeName",
    date: `eq.${latestDate}`,
    order: "portfolioSize.desc,code.asc",
    limit: "12000",
  });
  const rows = await fetchSupabaseRestJson<SupabaseFundSnapshotRow[]>(
    `FundDailySnapshot?${query.toString()}`,
    { revalidate: LIVE_DATA_CACHE_SEC, timeoutMs: 3_500, retries: 0 }
  );

  return rows.map(normalizeRestFundRow);
}

async function computeAllFundsFromLatestSnapshot(): Promise<FundListRow[]> {
  const latest = await prisma.fundDailySnapshot.findFirst({
    orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
    select: { date: true },
  });
  if (!latest) return [];

  const rows = await prisma.fundDailySnapshot.findMany({
    where: { date: latest.date },
    orderBy: [{ portfolioSize: "desc" }, { code: "asc" }],
    select: {
      fundId: true,
      code: true,
      name: true,
      shortName: true,
      logoUrl: true,
      portfolioSize: true,
      investorCount: true,
      lastPrice: true,
      dailyReturn: true,
      monthlyReturn: true,
      yearlyReturn: true,
      categoryCode: true,
      categoryName: true,
      fundTypeCode: true,
      fundTypeName: true,
      fund: {
        select: {
          logoUrl: true,
          shareCount: true,
          weeklyReturn: true,
        },
      },
    },
  });

  return rows.map((row) => {
    const fundType =
      row.fundTypeCode != null && row.fundTypeName
        ? fundTypeForApi({ code: row.fundTypeCode, name: row.fundTypeName })
        : null;

    return {
      id: row.fundId,
      code: row.code,
      name: row.name,
      shortName: row.shortName,
      logoUrl: getFundLogoUrlForUi(row.fundId, row.code, row.logoUrl ?? row.fund.logoUrl, row.name),
      portfolioSize: row.portfolioSize,
      lastPrice: row.lastPrice,
      dailyReturn: row.dailyReturn,
      weeklyReturn: row.fund.weeklyReturn,
      monthlyReturn: row.monthlyReturn,
      yearlyReturn: row.yearlyReturn,
      investorCount: row.investorCount,
      shareCount: row.fund.shareCount,
      category:
        row.categoryCode && row.categoryName
          ? { code: row.categoryCode, name: row.categoryName, color: null }
          : null,
      fundType,
    };
  });
}

async function getCachedAllFunds(): Promise<FundListRow[]> {
  const loadCached = unstable_cache(
    async () => computeAllFundsFromLatestSnapshot(),
    ["fund-list-all-v9"],
    { revalidate: LIVE_DATA_CACHE_SEC }
  );
  return loadCached();
}

async function getCachedAllFundsFromRest(): Promise<FundListRow[]> {
  const loadCached = unstable_cache(
    async () => computeAllFundsFromLatestSnapshotFromSupabaseRest(),
    ["fund-list-all-rest-v1"],
    { revalidate: LIVE_DATA_CACHE_SEC }
  );
  return loadCached();
}

export async function getAllFundsCached(): Promise<FundListRow[]> {
  if (hasSupabaseRestConfig()) {
    try {
      return await getCachedAllFundsFromRest();
    } catch (error) {
      console.warn("[fund-list] rest all-funds fallback to prisma", error);
    }
  }
  return getCachedAllFunds();
}

function parseSupabaseCountHeader(header: string | null): number {
  if (!header) return 0;
  const totalRaw = header.split("/")[1];
  const total = Number(totalRaw);
  return Number.isFinite(total) && total >= 0 ? total : 0;
}

async function queryFundsPageFromSupabaseRest(input: FundListQueryInput): Promise<FundListPageResult> {
  const latestRows = await fetchSupabaseRestJson<SupabaseSnapshotDateRow[]>(
    "FundDailySnapshot?select=date&order=date.desc&limit=1",
    { revalidate: LIVE_DATA_CACHE_SEC, timeoutMs: 1_500, retries: 0 }
  );
  const latestDate = latestRows[0]?.date;
  if (!latestDate) {
    return { items: [], page: input.page, pageSize: input.pageSize, total: 0, totalPages: 1, source: "rest" };
  }

  const offset = (input.page - 1) * input.pageSize;
  const params = new URLSearchParams({
    select:
      "fundId,code,name,shortName,logoUrl,portfolioSize,investorCount,lastPrice,dailyReturn,monthlyReturn,yearlyReturn,categoryCode,categoryName,fundTypeCode,fundTypeName",
    date: `eq.${latestDate}`,
    order: `${SUPABASE_SORT_FIELD_MAP[input.sortField]}.${input.sortDir},code.asc`,
    limit: String(input.pageSize),
    offset: String(offset),
  });

  if (input.category) params.set("categoryCode", `eq.${input.category}`);
  if (input.fundType) params.set("fundTypeCode", `eq.${input.fundType}`);
  if (input.q) {
    const escaped = input.q.replace(/[%_,()]/g, " ").trim();
    if (escaped) {
      params.set(
        "or",
        `(code.ilike.*${escaped}*,name.ilike.*${escaped}*,shortName.ilike.*${escaped}*)`
      );
    }
  }

  const response = await fetchSupabaseRestResponse(`FundDailySnapshot?${params.toString()}`, {
    revalidate: LIVE_DATA_CACHE_SEC,
    timeoutMs: 2_500,
    retries: 0,
    headers: { Prefer: "count=exact" },
  });
  const rows = (await response.json()) as SupabaseFundSnapshotRow[];
  const total = parseSupabaseCountHeader(response.headers.get("content-range"));

  return {
    items: rows.map(normalizeRestFundRow),
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
    source: "rest",
  };
}

function sortAndFilterFunds(items: FundListRow[], input: FundListQueryInput): FundListRow[] {
  const q = (input.q ?? "").trim().toLocaleLowerCase("tr-TR");
  const filtered = items.filter((fund) => {
    if (input.category && fund.category?.code !== input.category) return false;
    if (input.fundType && String(fund.fundType?.code ?? "") !== input.fundType) return false;
    if (!q) return true;
    return (
      fund.code.toLocaleLowerCase("tr-TR").includes(q) ||
      fund.name.toLocaleLowerCase("tr-TR").includes(q) ||
      (fund.shortName?.toLocaleLowerCase("tr-TR") ?? "").includes(q)
    );
  });

  return filtered.sort((a, b) => {
    const delta = Number(a[input.sortField]) - Number(b[input.sortField]);
    if (delta !== 0) return input.sortDir === "asc" ? delta : -delta;
    return a.code.localeCompare(b.code, "tr", { sensitivity: "base" });
  });
}

export async function getFundsPage(input: FundListQueryInput): Promise<FundListPageResult> {
  if (hasSupabaseRestConfig()) {
    try {
      return await queryFundsPageFromSupabaseRest(input);
    } catch (error) {
      console.warn("[fund-list] rest page fallback to prisma", error);
    }
  }
  const allFunds = await getCachedAllFunds();
  const items = sortAndFilterFunds(allFunds, input);
  const total = items.length;
  return {
    items: items.slice((input.page - 1) * input.pageSize, input.page * input.pageSize),
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
    source: "prisma",
  };
}

export async function getFundsTableBootstrap(): Promise<{
  items: FundListRow[];
  categories: FundListCategoryOption[];
  fundTypes: FundListTypeOption[];
}> {
  const items = await getCachedAllFunds();
  const filters = buildFilterOptionsFromItems(items);
  return {
    items,
    categories: filters.categories,
    fundTypes: filters.fundTypes,
  };
}

export async function getFundsTableBootstrapSafe(): Promise<{
  items: FundListRow[];
  categories: FundListCategoryOption[];
  fundTypes: FundListTypeOption[];
}> {
  try {
    return await getFundsTableBootstrap();
  } catch (error) {
    console.error("[fund-list] bootstrap failed", error);
    return {
      items: [],
      categories: [],
      fundTypes: [],
    };
  }
}

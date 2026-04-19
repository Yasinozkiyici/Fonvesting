/**
 * /sectors ve /indices için SSR’da ilk sayfa verisini üretir (client /api/funds beklemeden).
 * Yalnızca serving tabanlı yollar — ağır Prisma yolu yok.
 */

import { readServingFundListPrimary, type ServingListRow } from "@/lib/data-platform/read-side-serving";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import { listFundDetailCoreServingRows } from "@/lib/services/fund-detail-core-serving.service";
import type { FundListRow, FundListSortField } from "@/lib/services/fund-list.service";

const PAGE_SIZE = 50;
const SORT_FIELD: FundListSortField = "portfolioSize";

function readSortableValue(row: ServingListRow, field: FundListSortField): number {
  if (field === "portfolioSize") return row.portfolioSize;
  if (field === "dailyReturn") return row.dailyReturn;
  if (field === "lastPrice") return row.lastPrice;
  if (field === "investorCount") return row.investorCount;
  if (field === "monthlyReturn") return row.monthlyReturn;
  if (field === "yearlyReturn") return row.yearlyReturn;
  return 0;
}

function queryMatchesRow(row: ServingListRow, qLower: string): boolean {
  if (!qLower) return true;
  return row.searchHaystack.includes(qLower);
}

function servingRowToFundList(row: ServingListRow): FundListRow {
  return {
    id: row.code,
    code: row.code,
    name: row.name,
    shortName: row.shortName,
    logoUrl: getFundLogoUrlForUi(row.code, row.code, null, row.name),
    portfolioSize: row.portfolioSize,
    lastPrice: row.lastPrice,
    dailyReturn: row.dailyReturn,
    weeklyReturn: 0,
    monthlyReturn: row.monthlyReturn,
    yearlyReturn: row.yearlyReturn,
    investorCount: Math.round(row.investorCount),
    shareCount: 0,
    category:
      row.categoryCode ? { code: row.categoryCode, name: row.categoryCode, color: null } : null,
    fundType: row.fundTypeCode != null ? { code: row.fundTypeCode, name: String(row.fundTypeCode) } : null,
  };
}

function buildPageFromServingRows(input: {
  rows: ServingListRow[];
  page: number;
  q: string;
  category: string;
  fundType: string;
}): { items: FundListRow[]; total: number; totalPages: number } {
  const qLower = input.q.trim().toLocaleLowerCase("tr-TR");
  const filtered = input.rows
    .filter((row) => queryMatchesRow(row, qLower))
    .filter((row) => (input.category ? row.categoryCode === input.category : true))
    .filter((row) => (input.fundType ? String(row.fundTypeCode ?? "") === input.fundType : true));
  filtered.sort((left, right) => {
    const delta = readSortableValue(left, SORT_FIELD) - readSortableValue(right, SORT_FIELD);
    if (delta !== 0) return -delta;
    return left.code.localeCompare(right.code, "tr", { sensitivity: "base" });
  });
  const start = Math.max(0, (input.page - 1) * PAGE_SIZE);
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  return {
    items: pageRows.map(servingRowToFundList),
    total: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
  };
}

export async function loadFundsTableInitialSnapshot(input: {
  initialCategory?: string;
  initialFundType?: string;
  initialQuery?: string;
}): Promise<{ items: FundListRow[]; total: number; totalPages: number } | null> {
  const q = (input.initialQuery ?? "").trim().toLocaleLowerCase("tr-TR").slice(0, 64);
  const category = (input.initialCategory ?? "").trim().slice(0, 32);
  const fundType = (input.initialFundType ?? "").trim().slice(0, 8);
  const page = 1;

  try {
    const primary = await readServingFundListPrimary();
    const funds = primary.payload?.funds ?? [];
    if (funds.length > 0) {
      return buildPageFromServingRows({
        rows: funds,
        page,
        q,
        category,
        fundType,
      });
    }
  } catch {
    /* fall through */
  }

  try {
    const list = await listFundDetailCoreServingRows(Math.max(120, PAGE_SIZE * 3));
    if (list.rows.length === 0) return null;
    const synthetic: ServingListRow[] = list.rows.map((row) => {
      const codeLc = row.code.toLocaleLowerCase("tr-TR");
      const nameLc = row.name.toLocaleLowerCase("tr-TR");
      const shortLc = (row.shortName ?? "").toLocaleLowerCase("tr-TR");
      const hay = `${codeLc}\n${nameLc}\n${shortLc}`;
      return {
        code: row.code,
        name: row.name,
        shortName: row.shortName,
        categoryCode: row.categoryCode,
        fundTypeCode: row.fundTypeCode,
        lastPrice: row.lastPrice,
        dailyReturn: row.dailyReturn,
        monthlyReturn: row.monthlyReturn,
        yearlyReturn: row.yearlyReturn,
        portfolioSize: row.portfolioSize,
        investorCount: row.investorCount,
        searchHaystack: hay,
      };
    });
    return buildPageFromServingRows({ rows: synthetic, page, q, category, fundType });
  } catch {
    return null;
  }
}

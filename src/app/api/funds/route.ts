import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import { getFundsPage, type FundListSortField } from "@/lib/services/fund-list.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PAGE = 200;
const MAX_PAGE_SIZE = 100;
const MAX_QUERY_LENGTH = 64;
const MAX_FILTER_LENGTH = 32;

const SORT_FIELDS = new Set<FundListSortField>([
  "portfolioSize",
  "dailyReturn",
  "lastPrice",
  "investorCount",
  "weeklyReturn",
  "monthlyReturn",
  "yearlyReturn",
]);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const page = Math.min(MAX_PAGE, Math.max(1, Number(searchParams.get("page") ?? "1")));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("pageSize") ?? "50")));
    const q = (searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH).toLocaleLowerCase("tr-TR");
    const category = (searchParams.get("category") ?? "").trim().slice(0, MAX_FILTER_LENGTH);
    const fundType = (searchParams.get("fundType") ?? "").trim().slice(0, 8);
    const sort = searchParams.get("sort") ?? "portfolioSize:desc";
    const rawField = sort.split(":")[0] ?? "portfolioSize";
    const sortDirRaw = sort.split(":")[1];
    const sortField: FundListSortField = SORT_FIELDS.has(rawField as FundListSortField)
      ? (rawField as FundListSortField)
      : "portfolioSize";
    const sortDir = sortDirRaw === "asc" ? "asc" : "desc";

    const result = await getFundsPage({
      page,
      pageSize,
      q,
      category,
      fundType,
      sortField,
      sortDir,
    });

    const pagedItems = result.items.map((item) => ({
      ...item,
      sparkline: [] as number[],
      sparklineTrend:
        item.dailyReturn > 0 ? "up" : item.dailyReturn < 0 ? ("down" as const) : ("flat" as const),
    }));

    return NextResponse.json(
      {
        items: pagedItems,
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
      },
      {
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
        },
      }
    );
  } catch (e) {
    console.error("[api/funds]", e);
    const devDetail = process.env.NODE_ENV !== "production" && e instanceof Error ? e.message : undefined;
    return NextResponse.json(
      { error: "funds_failed", ...(devDetail ? { detail: devDetail } : {}) },
      { status: 500 }
    );
  }
}

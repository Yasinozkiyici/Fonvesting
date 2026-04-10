import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import { getFundsPage } from "@/lib/services/fund-list.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PAGE = 200;
const MAX_PAGE_SIZE = 100;
const MAX_QUERY_LENGTH = 64;
const MAX_FILTER_LENGTH = 32;

type LegacyStockRow = {
  id: string;
  symbol: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  marketCap: number;
  lastPrice: number;
  previousClose: number | null;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  turnover: number;
  peRatio: number | null;
  sparkline: number[];
  sparklineTrend: "up" | "down" | "flat";
  sector: { code: string; name: string; color: string | null } | null;
};

function mapSortField(field: string): "portfolioSize" | "dailyReturn" | "investorCount" | "lastPrice" {
  if (field === "changePercent") return "dailyReturn";
  if (field === "volume") return "investorCount";
  if (field === "lastPrice") return "lastPrice";
  return "portfolioSize";
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const page = Math.min(MAX_PAGE, Math.max(1, Number(searchParams.get("page") ?? "1")));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("pageSize") ?? "50")));
    const q = (searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH).toLocaleLowerCase("tr-TR");
    const sector = (searchParams.get("sector") ?? "").trim().slice(0, MAX_FILTER_LENGTH);
    const indexCode = (searchParams.get("index") ?? "").trim().slice(0, 8);
    const sort = searchParams.get("sort") ?? "marketCap:desc";
    const rawField = sort.split(":")[0] ?? "marketCap";
    const sortDirRaw = sort.split(":")[1];
    const sortField = mapSortField(rawField);
    const sortDir = sortDirRaw === "asc" ? "asc" : "desc";

    const result = await getFundsPage({
      page,
      pageSize,
      q,
      category: sector,
      fundType: indexCode,
      sortField,
      sortDir,
    });

    const items = result.items.map<LegacyStockRow>((fund) => {
        const dailyRatio = fund.dailyReturn / 100;
        const derivedPrev =
          fund.dailyReturn !== 0 &&
          Number.isFinite(fund.dailyReturn) &&
          Math.abs(fund.dailyReturn) < 99.9 &&
          fund.lastPrice > 0
            ? fund.lastPrice / (1 + dailyRatio)
            : null;

        return {
          id: fund.id,
          symbol: fund.code,
          name: fund.name,
          shortName: fund.shortName,
          logoUrl: fund.logoUrl,
          marketCap: fund.portfolioSize,
          lastPrice: fund.lastPrice,
          previousClose: null,
          change: derivedPrev != null ? fund.lastPrice - derivedPrev : 0,
          changePercent: fund.dailyReturn,
          dayHigh: fund.lastPrice,
          dayLow: fund.lastPrice,
          volume: fund.investorCount,
          turnover: fund.portfolioSize,
          peRatio: null,
          sparkline: [],
          sparklineTrend:
            fund.dailyReturn > 0 ? "up" : fund.dailyReturn < 0 ? ("down" as const) : ("flat" as const),
          sector: fund.category,
        };
      });

    return NextResponse.json(
      {
        items,
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
    console.error(e);
    return NextResponse.json({ error: "stocks_legacy_failed" }, { status: 500 });
  }
}

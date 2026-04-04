import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getCategorySummariesFromDailySnapshot } from "@/lib/services/fund-daily-snapshot.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CACHE_SEC = 86_400;

async function computeCategoriesPayload() {
  return getCategorySummariesFromDailySnapshot();
}

const getCachedCategories = unstable_cache(computeCategoriesPayload, ["api-categories-v1"], {
  revalidate: CACHE_SEC,
});

export async function GET() {
  try {
    const out = await getCachedCategories();
    return NextResponse.json(out);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "categories_failed" }, { status: 500 });
  }
}

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getFundDetailPageData } from "@/lib/services/fund-detail.service";

/** Aynı istek içinde metadata + sayfa için tek tur; istekler arasında da günlük snapshot tarihine göre cache'lenir. */
export const loadFundDetailPageData = cache(async (rawCode: string) => {
  const normalizedCode = rawCode.trim().toUpperCase();
  if (!normalizedCode) return null;

  const loadCached = unstable_cache(
    async () => getFundDetailPageData(normalizedCode),
    ["fund-detail-v8", normalizedCode],
    { revalidate: 300 }
  );

  return loadCached();
});

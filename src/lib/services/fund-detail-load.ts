import { cache } from "react";
import { getFundDetailPageData } from "@/lib/services/fund-detail.service";

/** Aynı istek içinde metadata + sayfa için tek tur; istekler arasında da günlük snapshot tarihine göre cache'lenir. */
export const loadFundDetailPageData = cache(async (rawCode: string) => {
  const normalizedCode = rawCode.trim().toUpperCase();
  if (!normalizedCode) return null;
  return getFundDetailPageData(normalizedCode);
});

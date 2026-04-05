import { cache } from "react";
import { getFundDetailPageData } from "@/lib/services/fund-detail.service";

/** Aynı istek içinde metadata + sayfa için tek Prisma turu */
export const loadFundDetailPageData = cache(async (rawCode: string) => getFundDetailPageData(rawCode));

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { Prisma } from "@prisma/client";
import { LIVE_DATA_CACHE_SEC, readCompareDataVersion } from "@/lib/data-freshness";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import type { PricePoint } from "@/lib/scoring";
import {
  computeKiyasPeriodRowsForFundRef,
  fetchKiyasMacroBuckets,
  KIYAS_REF_LABELS,
  resolveKiyasReferenceOrder,
  type KiyasBand,
  type KiyasDerivedSlice,
  type KiyasPeriodId,
  type KiyasPeriodRow,
  type KiyasRefKey,
} from "@/lib/services/fund-detail-kiyas.service";

const HISTORY_CAP = 900;
const HISTORY_LOOKBACK_DAYS = 1125;

const REF_MERGE_ORDER: KiyasRefKey[] = ["category", "policy", "bist100", "gold", "usdtry", "eurtry"];

const PERIODS: Array<{ id: KiyasPeriodId; label: string }> = [
  { id: "1m", label: "1 Ay" },
  { id: "3m", label: "3 Ay" },
  { id: "6m", label: "6 Ay" },
  { id: "1y", label: "1 Yıl" },
  { id: "2y", label: "2 Yıl" },
  { id: "3y", label: "3 Yıl" },
];

export type ComparePeriodRowDto = {
  periodId: KiyasPeriodId;
  label: string;
  fundPct: number | null;
  refPct: number | null;
  refPolicyDeltaPp: number | null;
  band: KiyasBand | null;
  diffPct: number | null;
};

export type CompareContextDto = {
  anchorDate: string;
  refs: { key: KiyasRefKey; label: string }[];
  defaultRef: KiyasRefKey;
  periods: typeof PERIODS;
  summaryByRef: Partial<Record<KiyasRefKey, string>>;
  matrix: Record<string, Partial<Record<KiyasRefKey, ComparePeriodRowDto[]>>>;
};

export type CompareFundExtras = {
  volatility1y: number | null;
  maxDrawdown1y: number | null;
  variabilityLabel: "Sakin" | "Orta" | "Geniş" | null;
};

export type InternalCompareFund = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  categoryId: string | null;
  categoryCode: string | null;
  fundTypeCode: number | null;
  fundTypeName: string | null;
};

type CategoryAverageAccumulator = {
  count: number;
  return30dSum: number;
  return30dCount: number;
  return90dSum: number;
  return90dCount: number;
  return180dSum: number;
  return180dCount: number;
  return1ySum: number;
  return1yCount: number;
  return2ySum: number;
  return2yCount: number;
};

function normalizeHistorySessionDate(date: Date): Date {
  return startOfUtcDay(new Date(date.getTime() + 3 * 60 * 60 * 1000));
}

function dedupeSessionPricePoints(rows: Array<{ date: Date; price: number }>): PricePoint[] {
  const sessions = new Map<number, PricePoint>();
  for (const row of rows) {
    if (!Number.isFinite(row.price) || row.price <= 0) continue;
    const sessionDate = normalizeHistorySessionDate(row.date);
    sessions.set(sessionDate.getTime(), { date: sessionDate, price: row.price });
  }
  return [...sessions.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

function compareCodeKey(code: string): string {
  return code.trim().toUpperCase();
}

function rowToDto(r: KiyasPeriodRow): ComparePeriodRowDto {
  return {
    periodId: r.periodId,
    label: r.label,
    fundPct: r.fundPct,
    refPct: r.refPct,
    refPolicyDeltaPp: r.refPolicyDeltaPp,
    band: r.band,
    diffPct: r.diffPct,
  };
}

export function variabilityLabelFromVol(vol1y: number | null): CompareFundExtras["variabilityLabel"] {
  if (vol1y == null || !Number.isFinite(vol1y) || vol1y <= 0) return null;
  if (vol1y <= 12) return "Sakin";
  if (vol1y >= 24) return "Geniş";
  return "Orta";
}

export function compareExtrasFromDerived(
  row: { volatility1y: number | null; maxDrawdown1y: number | null } | null | undefined
): CompareFundExtras {
  const vol = row?.volatility1y ?? null;
  return {
    volatility1y: vol,
    maxDrawdown1y: row?.maxDrawdown1y ?? null,
    variabilityLabel: variabilityLabelFromVol(vol),
  };
}

function buildCompareSummaryForRef(
  ref: KiyasRefKey,
  fundCodes: string[],
  matrix: Record<string, Partial<Record<KiyasRefKey, ComparePeriodRowDto[]>>>
): string {
  const y1s = fundCodes.map((code) => matrix[code]?.[ref]?.find((x) => x.periodId === "1y"));
  const refName = KIYAS_REF_LABELS[ref];

  if (ref === "policy") {
    const refPct = y1s.find((r) => r?.refPct != null)?.refPct;
    if (refPct == null || !Number.isFinite(refPct)) {
      return "Faiz çizgisi bu dilimde okunamıyor; yatırım tavsiyesi değildir.";
    }
    const fundsWithPct = y1s.map((r, i) => ({ f: r?.fundPct, code: fundCodes[i]! }));
    const n = fundCodes.length;
    const pos = fundsWithPct.filter((x) => x.f != null && x.f > 0.5).length;
    const neg = fundsWithPct.filter((x) => x.f != null && x.f < -0.5).length;
    if (pos === n) return "Seçkideki kodların tamamı ölçeklenmiş faiz eşiğinin üstünde görünüyor. Tavsiye değildir.";
    if (neg === n) return "Seçkideki kodların tamamı ölçeklenmiş faiz eşiğinin altında görünüyor. Tavsiye değildir.";
    if (pos > 0 && neg > 0) return "Ölçeklenmiş faiz eşiğine göre seçkide ayrışma var. Tavsiye değildir.";
    return "Faiz referansı yıllık politika oranından vadeye ölçeklenmiştir; fon yüzdeleri tabloda. Tavsiye değildir.";
  }

  const bands = y1s.map((r) => r?.band ?? null);
  const above = bands.filter((b) => b === "above").length;
  const below = bands.filter((b) => b === "below").length;
  const near = bands.filter((b) => b === "near").length;
  const defined = above + below + near;
  const n = fundCodes.length;

  if (defined === 0) {
    return `${refName} için bu dilimde karşılaştırma bandı oluşmuyor; tavsiye değildir.`;
  }
  if (above === n) return `Son bir yılda seçkinin tamamı ${refName}’e göre üst bantta kaldı; mutlak üstünlük iddiası değildir.`;
  if (below === n) return `Son bir yılda seçkinin tamamı ${refName}’e göre daha geride; tavsiye değildir.`;
  if (above > 0 && below > 0) {
    return `${refName}’e göre biri üst bantta biri daha geride; tablo ayrıntıyı verir. Tavsiye değildir.`;
  }
  if (near >= n - 1 && near > 0) {
    return `Son bir yılda ${refName} ile daha dengeli, yakın bantta kalan seçenekler var. Tavsiye değildir.`;
  }
  return `${refName} karşılaştırmasında seçki karışık; tabloya bakın. Tavsiye değildir.`;
}

function buildAverageExcludingFund(
  aggregate: CategoryAverageAccumulator,
  row: {
    return30d: number | null;
    return90d: number | null;
    return180d: number | null;
    return1y: number | null;
    return2y: number | null;
  }
): KiyasDerivedSlice | null {
  const others = aggregate.count - 1;
  if (others < 5) return null;

  const avgValue = (sum: number, count: number, value: number | null): number | null => {
    if (count <= (value != null ? 1 : 0)) return null;
    const nextSum = value != null ? sum - value : sum;
    const nextCount = count - (value != null ? 1 : 0);
    if (nextCount <= 0) return null;
    return nextSum / nextCount;
  };

  return {
    return30d: avgValue(aggregate.return30dSum, aggregate.return30dCount, row.return30d),
    return90d: avgValue(aggregate.return90dSum, aggregate.return90dCount, row.return90d),
    return180d: avgValue(aggregate.return180dSum, aggregate.return180dCount, row.return180d),
    return1y: avgValue(aggregate.return1ySum, aggregate.return1yCount, row.return1y),
    return2y: avgValue(aggregate.return2ySum, aggregate.return2yCount, row.return2y),
    return3y: null,
  };
}

export type CompareBuildResult = {
  context: CompareContextDto | null;
  extrasByFundId: Record<string, CompareFundExtras>;
};

type CategoryAggregateRow = {
  categoryId: string;
  count: number;
  return30dSum: number;
  return30dCount: number;
  return90dSum: number;
  return90dCount: number;
  return180dSum: number;
  return180dCount: number;
  return1ySum: number;
  return1yCount: number;
  return2ySum: number;
  return2yCount: number;
};

async function loadCategoryAggregates(categoryIds: string[]): Promise<Map<string, CategoryAverageAccumulator>> {
  if (categoryIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<CategoryAggregateRow[]>(Prisma.sql`
    SELECT
      f."categoryId" AS "categoryId",
      COUNT(*)::int AS "count",
      COALESCE(SUM(dm."return30d"), 0)::double precision AS "return30dSum",
      COUNT(dm."return30d")::int AS "return30dCount",
      COALESCE(SUM(dm."return90d"), 0)::double precision AS "return90dSum",
      COUNT(dm."return90d")::int AS "return90dCount",
      COALESCE(SUM(dm."return180d"), 0)::double precision AS "return180dSum",
      COUNT(dm."return180d")::int AS "return180dCount",
      COALESCE(SUM(dm."return1y"), 0)::double precision AS "return1ySum",
      COUNT(dm."return1y")::int AS "return1yCount",
      COALESCE(SUM(dm."return2y"), 0)::double precision AS "return2ySum",
      COUNT(dm."return2y")::int AS "return2yCount"
    FROM "FundDerivedMetrics" dm
    INNER JOIN "Fund" f ON f."id" = dm."fundId"
    WHERE f."isActive" = true
      AND f."categoryId" IN (${Prisma.join(categoryIds)})
    GROUP BY f."categoryId"
  `);

  return new Map(
    rows.map((row) => [
      row.categoryId,
      {
        count: row.count,
        return30dSum: row.return30dSum,
        return30dCount: row.return30dCount,
        return90dSum: row.return90dSum,
        return90dCount: row.return90dCount,
        return180dSum: row.return180dSum,
        return180dCount: row.return180dCount,
        return1ySum: row.return1ySum,
        return1yCount: row.return1yCount,
        return2ySum: row.return2ySum,
        return2yCount: row.return2yCount,
      },
    ])
  );
}

export async function buildCompareContext(funds: InternalCompareFund[]): Promise<CompareBuildResult | null> {
  if (funds.length === 0) return null;

  const ids = funds.map((f) => f.id);
  const uniqueCategoryIds = [...new Set(funds.map((fund) => fund.categoryId).filter(Boolean))] as string[];
  const historyFrom = startOfUtcDay(new Date(Date.now() - HISTORY_LOOKBACK_DAYS * 86_400_000));

  const [snapDates, derivedList, histories, categoryAggregates] = await Promise.all([
    prisma.fundDailySnapshot.groupBy({
      by: ["fundId"],
      where: { fundId: { in: ids } },
      _max: { date: true },
    }),
    prisma.fundDerivedMetrics.findMany({
      where: { fundId: { in: ids } },
      select: {
        fundId: true,
        return30d: true,
        return90d: true,
        return180d: true,
        return1y: true,
        return2y: true,
        volatility1y: true,
        maxDrawdown1y: true,
      },
    }),
    prisma.fundPriceHistory.findMany({
      where: { fundId: { in: ids }, date: { gte: historyFrom } },
      orderBy: [{ fundId: "asc" }, { date: "desc" }],
      select: { fundId: true, date: true, price: true },
    }),
    loadCategoryAggregates(uniqueCategoryIds),
  ]);

  const snapByFund = new Map(snapDates.map((s) => [s.fundId, s._max.date]));
  const dates = [...snapByFund.values()].filter(Boolean) as Date[];
  const anchor =
    dates.length > 0 ? startOfUtcDay(new Date(Math.min(...dates.map((d) => d.getTime())))) : startOfUtcDay(new Date());

  const derivedByFund = new Map(derivedList.map((d) => [d.fundId, d]));

  const historyByFund = new Map<string, Array<{ date: Date; price: number }>>();
  for (const h of histories) {
    const arr = historyByFund.get(h.fundId) ?? [];
    if (arr.length < HISTORY_CAP) {
      arr.push({ date: h.date, price: h.price });
    }
    historyByFund.set(h.fundId, arr);
  }
  for (const [fid, arr] of historyByFund) {
    arr.sort((a, b) => a.date.getTime() - b.date.getTime());
    historyByFund.set(fid, arr);
  }

  const macroByRef = await fetchKiyasMacroBuckets(anchor);

  const categoryAvgsByFund = new Map<string, KiyasDerivedSlice | null>();
  for (const fund of funds) {
    if (!fund.categoryId) {
      categoryAvgsByFund.set(fund.id, null);
      continue;
    }
    const aggregate = categoryAggregates.get(fund.categoryId);
    const selfRow = derivedByFund.get(fund.id);
    categoryAvgsByFund.set(
      fund.id,
      aggregate && selfRow ? buildAverageExcludingFund(aggregate, selfRow) : null
    );
  }

  const vote = new Map<KiyasRefKey, number>();
  for (const f of funds) {
    const ord = resolveKiyasReferenceOrder(f.categoryCode, f.fundTypeCode, f.name);
    ord.forEach((k, i) => vote.set(k, (vote.get(k) ?? 0) + (ord.length - i)));
  }

  const anyCategory = [...categoryAvgsByFund.values()].some((v) => v != null);
  const refAvailable = (k: KiyasRefKey): boolean => {
    if (k === "category") return anyCategory;
    if (k === "policy") return (macroByRef.policy?.length ?? 0) >= 2;
    return (macroByRef[k]?.length ?? 0) >= 2;
  };

  const sortedKeys = [...REF_MERGE_ORDER].filter(refAvailable).sort(
    (a, b) => (vote.get(b) ?? 0) - (vote.get(a) ?? 0)
  );
  const refsOrdered = sortedKeys.map((key) => ({ key, label: KIYAS_REF_LABELS[key] }));

  const extrasByFundId: Record<string, CompareFundExtras> = {};
  for (const f of funds) {
    extrasByFundId[f.id] = compareExtrasFromDerived(derivedByFund.get(f.id));
  }

  if (refsOrdered.length === 0) {
    return { context: null, extrasByFundId };
  }

  const matrix: Record<string, Partial<Record<KiyasRefKey, ComparePeriodRowDto[]>>> = {};

  for (const f of funds) {
    const d = derivedByFund.get(f.id);
    const derivedSlice: KiyasDerivedSlice | null = d
      ? {
          return30d: d.return30d,
          return90d: d.return90d,
          return180d: d.return180d,
          return1y: d.return1y,
          return2y: d.return2y,
          return3y: null,
        }
      : null;
    const rawHist = historyByFund.get(f.id) ?? [];
    const points = dedupeSessionPricePoints(rawHist);
    const categoryAvgs = categoryAvgsByFund.get(f.id) ?? null;

    const codeKey = f.code.trim().toUpperCase();
    matrix[codeKey] = {};
    for (const { key } of refsOrdered) {
      const rows = computeKiyasPeriodRowsForFundRef(key, anchor, derivedSlice, points, categoryAvgs, macroByRef);
      if (rows.length > 0) {
        matrix[codeKey]![key] = rows.map(rowToDto);
      }
    }
  }

  const codes = funds.map((f) => f.code.trim().toUpperCase());
  const summaryByRef: Partial<Record<KiyasRefKey, string>> = {};
  for (const { key } of refsOrdered) {
    summaryByRef[key] = buildCompareSummaryForRef(key, codes, matrix);
  }

  return {
    context: {
      anchorDate: anchor.toISOString(),
      refs: refsOrdered,
      defaultRef: refsOrdered[0]!.key,
      periods: PERIODS,
      summaryByRef,
      matrix,
    },
    extrasByFundId,
  };
}

export const loadCompareContext = cache(async (funds: InternalCompareFund[]) => {
  const codesKey = funds.map((fund) => compareCodeKey(fund.code)).join(",");
  const version = await readCompareDataVersion();
  const loadCached = unstable_cache(
    async () => buildCompareContext(funds),
    ["compare-context-v2", codesKey, version],
    { revalidate: LIVE_DATA_CACHE_SEC }
  );
  return loadCached();
});

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import { computeDerivedFromPricePoints } from "@/lib/derived-metrics/compute-from-history";
import {
  buildExtendedNormalizationContext,
  calculateFinalScore,
  calculateNormalizedScoresExtended,
  compareRankedFunds,
  percentileFromSortedAsc,
  type FundMetrics,
  type FundScaleFields,
  type NormalizedScores,
  type RankingMode,
} from "@/lib/scoring";
import { fetchKiyasMacroBuckets, kiyasMacroTotalReturnPct, type KiyasRefKey } from "@/lib/services/fund-detail-kiyas.service";
import {
  deriveFundPerformanceFromHistory,
  FUND_PRICE_HISTORY_LOOKBACK_DAYS,
  type FundHistoryPoint,
  loadPriceHistoryByFundId,
} from "@/lib/services/fund-daily-snapshot.service";
import type { ScoredFundRow, ScoresApiPayload } from "@/lib/services/fund-scores-types";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import { fundTypeForApi } from "@/lib/fund-type-display";

const UPSERT_BATCH = 80;

function isRelationMissingError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021";
}

/** ~2 yıllık geçmişten türetilmiş satırları yazar / günceller (senkron / job). */
export async function rebuildFundDerivedMetrics(): Promise<{ written: number }> {
  const dayMs = 24 * 60 * 60 * 1000;
  const fromDate = new Date(Date.now() - FUND_PRICE_HISTORY_LOOKBACK_DAYS * dayMs);

  const funds = await prisma.fund.findMany({
    where: { isActive: true },
    select: {
      id: true,
      category: { select: { code: true } },
      fundType: { select: { code: true } },
      portfolioSize: true,
      investorCount: true,
    },
  });

  const historyByFund = await loadPriceHistoryByFundId(
    funds.map((f) => f.id),
    fromDate
  );

  const now = new Date();
  let written = 0;

  for (let i = 0; i < funds.length; i += UPSERT_BATCH) {
    const slice = funds.slice(i, i + UPSERT_BATCH);
    await prisma.$transaction(
      slice.map((fund) => {
        const rows = historyByFund.get(fund.id) ?? [];
        const perf = deriveFundPerformanceFromHistory(rows);
        const derived = computeDerivedFromPricePoints(perf.pricePoints);
        const spark = JSON.parse(JSON.stringify(derived.sparklinePrices)) as Prisma.InputJsonValue;
        const latestStats = rows.length > 0 ? rows[rows.length - 1] : null;
        const latestInvestorCount =
          latestStats && Number.isFinite((latestStats as FundHistoryPoint).investorCount)
            ? latestStats.investorCount
            : fund.investorCount;
        const latestPortfolioSize =
          latestStats && Number.isFinite((latestStats as FundHistoryPoint).portfolioSize)
            ? latestStats.portfolioSize
            : fund.portfolioSize;

        return prisma.fundDerivedMetrics.upsert({
          where: { fundId: fund.id },
          create: {
            fundId: fund.id,
            categoryCode: fund.category?.code ?? null,
            fundTypeCode: fund.fundType?.code ?? null,
            latestPrice: derived.latestPrice || 0,
            return1d: derived.return1d,
            return7d: derived.return7d,
            return30d: derived.return30d,
            return90d: derived.return90d,
            return180d: derived.return180d,
            return1y: derived.return1y,
            return2y: derived.return2y,
            volatility1y: derived.volatility1y,
            volatility2y: derived.volatility2y,
            maxDrawdown1y: derived.maxDrawdown1y,
            maxDrawdown2y: derived.maxDrawdown2y,
            annualizedReturn1y: derived.annualizedReturn1y,
            sharpe1y: derived.sharpe1y,
            sortino1y: derived.sortino1y,
            totalReturn2y: derived.totalReturn2y,
            investorCount: latestInvestorCount,
            aum: latestPortfolioSize,
            historySessions: derived.historySessions,
            sparkline: spark,
            computedAt: now,
          },
          update: {
            categoryCode: fund.category?.code ?? null,
            fundTypeCode: fund.fundType?.code ?? null,
            latestPrice: derived.latestPrice || 0,
            return1d: derived.return1d,
            return7d: derived.return7d,
            return30d: derived.return30d,
            return90d: derived.return90d,
            return180d: derived.return180d,
            return1y: derived.return1y,
            return2y: derived.return2y,
            volatility1y: derived.volatility1y,
            volatility2y: derived.volatility2y,
            maxDrawdown1y: derived.maxDrawdown1y,
            maxDrawdown2y: derived.maxDrawdown2y,
            annualizedReturn1y: derived.annualizedReturn1y,
            sharpe1y: derived.sharpe1y,
            sortino1y: derived.sortino1y,
            totalReturn2y: derived.totalReturn2y,
            investorCount: latestInvestorCount,
            aum: latestPortfolioSize,
            historySessions: derived.historySessions,
            sparkline: spark,
            computedAt: now,
          },
        });
      })
    );
    written += slice.length;
  }

  return { written };
}

type DerivedRow = {
  fundId: string;
  latestPrice: number;
  return1d: number;
  return7d: number | null;
  return30d: number | null;
  return90d: number | null;
  return180d: number | null;
  return1y: number | null;
  return2y: number | null;
  volatility1y: number | null;
  volatility2y: number | null;
  maxDrawdown1y: number | null;
  maxDrawdown2y: number | null;
  annualizedReturn1y: number;
  sharpe1y: number;
  sortino1y: number;
  totalReturn2y: number | null;
  investorCount: number;
  aum: number;
  historySessions: number;
  categoryCode: string | null;
  fund: {
    id: string;
    categoryId: string | null;
    code: string;
    name: string;
    shortName: string | null;
    logoUrl: string | null;
    category: { code: string; name: string } | null;
    fundType: { code: number; name: string } | null;
  };
};

function toFundMetrics(r: DerivedRow): FundMetrics {
  return {
    totalReturn: r.totalReturn2y ?? r.return1y ?? 0,
    annualizedReturn: r.annualizedReturn1y,
    volatility: r.volatility1y ?? 0,
    maxDrawdown: r.maxDrawdown1y ?? 0,
    sharpeRatio: r.sharpe1y,
    sortinoRatio: r.sortino1y,
    calmarRatio: 0,
    winRate: 0,
    avgGain: 0,
    avgLoss: 0,
    dataPoints: r.historySessions,
  };
}

function toScale(r: DerivedRow): FundScaleFields {
  return {
    portfolioSize: r.aum,
    investorCount: r.investorCount,
    yearlyReturn: r.return1y ?? 0,
  };
}

const MIN_CATEGORY_FUNDS = 5;

/** Çok pencereli (1y ağırlıklı) trailing getiri — yüksek getiri sırası için. */
export function highReturnTrailingBlend(r: DerivedRow): number {
  let acc = 0;
  let wsum = 0;
  const parts: Array<[number | null | undefined, number]> = [
    [r.return1y, 0.45],
    [r.return180d, 0.25],
    [r.return90d, 0.15],
    [r.return30d, 0.15],
  ];
  for (const [v, w] of parts) {
    if (v != null && Number.isFinite(v)) {
      acc += w * v;
      wsum += w;
    }
  }
  return wsum > 0 ? acc / wsum : Number.NEGATIVE_INFINITY;
}

function buildCategory1yAggregates(rows: DerivedRow[]): Map<string, { sum: number; count: number }> {
  const m = new Map<string, { sum: number; count: number }>();
  for (const r of rows) {
    const cid = r.fund.categoryId;
    if (!cid || r.return1y == null || !Number.isFinite(r.return1y)) continue;
    const a = m.get(cid) ?? { sum: 0, count: 0 };
    a.sum += r.return1y;
    a.count += 1;
    m.set(cid, a);
  }
  return m;
}

function category1yEdge(row: DerivedRow, agg: Map<string, { sum: number; count: number }>): number | null {
  const cid = row.fund.categoryId;
  const y = row.return1y;
  if (!cid || y == null || !Number.isFinite(y)) return null;
  const a = agg.get(cid);
  if (!a || a.count < MIN_CATEGORY_FUNDS) return null;
  const othersSum = a.sum - y;
  const others = a.count - 1;
  if (others < MIN_CATEGORY_FUNDS - 1) return null;
  return y - othersSum / others;
}

function returnWindowStd(row: DerivedRow): number | null {
  const v = [row.return30d, row.return90d, row.return180d, row.return1y].filter(
    (x): x is number => x != null && Number.isFinite(x)
  );
  if (v.length < 3) return null;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const varp = v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length;
  return Math.sqrt(varp);
}

function pickReferenceExcess1y(
  row: DerivedRow,
  macroByRef: Partial<Record<KiyasRefKey, Array<{ date: Date; value: number }>>>,
  anchor: Date
): number | null {
  const r1 = row.return1y;
  if (r1 == null || !Number.isFinite(r1)) return null;
  const c = (row.fund.category?.code ?? "").toUpperCase();
  const n = row.fund.name.toUpperCase();
  const b = macroByRef.bist100;
  const g = macroByRef.gold;
  const u = macroByRef.usdtry;

  const bistR = b && b.length >= 2 ? kiyasMacroTotalReturnPct(b, anchor, 365) : null;
  const goldR = g && g.length >= 2 ? kiyasMacroTotalReturnPct(g, anchor, 365) : null;
  const usdR = u && u.length >= 2 ? kiyasMacroTotalReturnPct(u, anchor, 365) : null;

  if (c === "ALT") {
    if (goldR != null) return r1 - goldR;
    return bistR != null ? r1 - bistR : null;
  }
  if (c === "DYF" || n.includes("DÖVİZ") || n.includes("DOVIZ") || n.includes("DOLAR") || n.includes("EURO")) {
    return usdR != null ? r1 - usdR : null;
  }
  if (c === "PPF" || c === "BRC" || c === "BYF" || c === "OKS" || c === "OKCF" || c === "GYIF") {
    return null;
  }
  if (c === "HSF" || c === "HYF" || c === "KTL") {
    return bistR != null ? r1 - bistR : usdR != null ? r1 - usdR : null;
  }
  return bistR != null ? r1 - bistR : null;
}

/**
 * Ham geçmiş taramadan skor listesi: FundDerivedMetrics + filtrelenmiş evrende yüzdelik.
 */
export async function getScoresPayloadFromDerivedMetrics(
  mode: RankingMode,
  categoryKey: string,
  queryTrim: string
): Promise<ScoresApiPayload | null> {
  try {
    const n = await prisma.fundDerivedMetrics.count();
    if (n === 0) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[scores-derived] FundDerivedMetrics boş; snapshot yolu deneniyor.");
      }
      return null;
    }
  } catch (e) {
    if (isRelationMissingError(e)) return null;
    throw e;
  }

  const q = queryTrim.trim();
  const where: Prisma.FundDerivedMetricsWhereInput = {
    fund: {
      isActive: true,
      ...(categoryKey ? { category: { code: categoryKey } } : {}),
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
  };

  let rows: DerivedRow[];
  try {
    rows = (await prisma.fundDerivedMetrics.findMany({
      where,
      select: {
        fundId: true,
        latestPrice: true,
        return1d: true,
        return7d: true,
        return30d: true,
        return90d: true,
        return180d: true,
        return1y: true,
        return2y: true,
        volatility1y: true,
        volatility2y: true,
        maxDrawdown1y: true,
        maxDrawdown2y: true,
        annualizedReturn1y: true,
        sharpe1y: true,
        sortino1y: true,
        totalReturn2y: true,
        investorCount: true,
        aum: true,
        historySessions: true,
        categoryCode: true,
        fund: {
          select: {
            id: true,
            categoryId: true,
            code: true,
            name: true,
            shortName: true,
            logoUrl: true,
            category: { select: { code: true, name: true } },
            fundType: { select: { code: true, name: true } },
          },
        },
      },
    })) as DerivedRow[];
  } catch (e) {
    if (isRelationMissingError(e)) return null;
    throw e;
  }

  if (mode === "HIGH_RETURN" && rows.length === 0) {
    console.warn(
      `[scores-derived] HIGH_RETURN boş: category=${categoryKey || "all"} query=${q || "(yok)"}`
    );
  }

  const metricsList = rows.map(toFundMetrics);
  const scales = rows.map(toScale);
  const extCtx = buildExtendedNormalizationContext(metricsList, scales);

  const anchor = startOfUtcDay(new Date());
  const macroByRef = await fetchKiyasMacroBuckets(anchor);
  const catAgg = buildCategory1yAggregates(rows);
  const catEdgeRaw = rows.map((r) => category1yEdge(r, catAgg));
  const refExcRaw = rows.map((r) => pickReferenceExcess1y(r, macroByRef, anchor));
  const consSdRaw = rows.map((r) => returnWindowStd(r));

  const sortAsc = (xs: number[]) => [...xs].sort((a, b) => a - b);
  const sortedCE = sortAsc(catEdgeRaw.filter((x): x is number => x != null && Number.isFinite(x)));
  const sortedRE = sortAsc(refExcRaw.filter((x): x is number => x != null && Number.isFinite(x)));
  const sortedSD = sortAsc(consSdRaw.filter((x): x is number => x != null && Number.isFinite(x)));

  const scored: Array<{ row: DerivedRow; finalScore: number; scores: NormalizedScores; metrics: FundMetrics }> =
    rows.map((row, i) => {
      const metrics = metricsList[i]!;
      const base = calculateNormalizedScoresExtended(metrics, extCtx, scales[i]!);
      const ce = catEdgeRaw[i]!;
      const categoryRelativeScore =
        ce == null || !Number.isFinite(ce)
          ? 50
          : Math.round(percentileFromSortedAsc(ce, sortedCE, true));
      const re = refExcRaw[i]!;
      const referenceStrengthScore =
        re == null || !Number.isFinite(re)
          ? 50
          : Math.round(percentileFromSortedAsc(re, sortedRE, true));
      const sd = consSdRaw[i]!;
      const consistencyScore =
        sd == null || !Number.isFinite(sd)
          ? 50
          : Math.round(percentileFromSortedAsc(sd, sortedSD, false));

      const scores: NormalizedScores = {
        ...base,
        categoryRelativeScore,
        referenceStrengthScore,
        consistencyScore,
      };
      const finalScore = calculateFinalScore(scores, mode);
      return { row, finalScore, scores, metrics };
    });

  scored.sort((a, b) =>
    compareRankedFunds(mode, {
      code: a.row.fund.code,
      finalScore: a.finalScore,
      scores: a.scores,
      yearlyReturn: a.row.return1y ?? 0,
      monthlyReturn: a.row.return30d ?? 0,
      metrics: a.metrics,
      trailingReturnBlend: highReturnTrailingBlend(a.row),
    }, {
      code: b.row.fund.code,
      finalScore: b.finalScore,
      scores: b.scores,
      yearlyReturn: b.row.return1y ?? 0,
      monthlyReturn: b.row.return30d ?? 0,
      metrics: b.metrics,
      trailingReturnBlend: highReturnTrailingBlend(b.row),
    })
  );

  const funds: ScoredFundRow[] = scored.map(({ row, finalScore }) => {
    const f = row.fund;

    return {
      fundId: f.id,
      code: f.code,
      name: f.name,
      shortName: f.shortName,
      logoUrl: getFundLogoUrlForUi(f.id, f.code, f.logoUrl, f.name),
      lastPrice: row.latestPrice,
      dailyReturn: row.return1d,
      portfolioSize: row.aum,
      investorCount: row.investorCount,
      category: f.category,
      fundType: fundTypeForApi(f.fundType),
      finalScore,
    };
  });

  return {
    mode,
    total: funds.length,
    funds,
    ...(q ? { appliedQuery: q } : {}),
  };
}

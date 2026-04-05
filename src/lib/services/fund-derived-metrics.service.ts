import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeDerivedFromPricePoints } from "@/lib/derived-metrics/compute-from-history";
import {
  buildExtendedNormalizationContext,
  calculateAlpha,
  calculateFinalScore,
  calculateNormalizedScoresExtended,
  determineRiskLevel,
  type FundMetrics,
  type FundScaleFields,
  type NormalizedScores,
  type RankingMode,
} from "@/lib/scoring";
import {
  deriveFundPerformanceFromHistory,
  FUND_PRICE_HISTORY_LOOKBACK_DAYS,
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
            investorCount: fund.investorCount,
            aum: fund.portfolioSize,
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
            investorCount: fund.investorCount,
            aum: fund.portfolioSize,
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
  sparkline: Prisma.JsonValue;
  categoryCode: string | null;
  fund: {
    id: string;
    code: string;
    name: string;
    shortName: string | null;
    logoUrl: string | null;
    lastPrice: number;
    dailyReturn: number;
    monthlyReturn: number;
    yearlyReturn: number;
    portfolioSize: number;
    investorCount: number;
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
  const f = r.fund;
  return {
    portfolioSize: r.aum,
    investorCount: r.investorCount,
    yearlyReturn: r.return1y ?? f.yearlyReturn ?? 0,
  };
}

/** Yüksek getiri: önce 1Y, yoksa kısa dönem zinciri; hiçbiri yoksa listenin sonuna. */
export function highReturnSortKey(r: DerivedRow): number {
  const chain = [r.return1y, r.return180d, r.return90d, r.return30d, r.return7d, r.return1d];
  for (const v of chain) {
    if (v != null && Number.isFinite(v)) return v;
  }
  return Number.NEGATIVE_INFINITY;
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
        sparkline: true,
        categoryCode: true,
        fund: {
          select: {
            id: true,
            code: true,
            name: true,
            shortName: true,
            logoUrl: true,
            lastPrice: true,
            dailyReturn: true,
            monthlyReturn: true,
            yearlyReturn: true,
            portfolioSize: true,
            investorCount: true,
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

  const scored: Array<{ row: DerivedRow; finalScore: number; scores: NormalizedScores }> = rows.map(
    (row, i) => {
      const metrics = metricsList[i]!;
      const scores = calculateNormalizedScoresExtended(metrics, extCtx, scales[i]!);
      const finalScore = calculateFinalScore(scores, mode);
      return { row, finalScore, scores };
    }
  );

  scored.sort((a, b) => {
    if (mode === "HIGH_RETURN") {
      const ka = highReturnSortKey(a.row);
      const kb = highReturnSortKey(b.row);
      if (kb !== ka) return kb - ka;
    }
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    return a.row.fund.code.localeCompare(b.row.fund.code, "tr");
  });

  const funds: ScoredFundRow[] = scored.map(({ row, finalScore, scores }) => {
    const f = row.fund;
    const catCode = f.category?.code ?? row.categoryCode ?? "DGR";
    const metrics = toFundMetrics(row);
    const alpha = calculateAlpha(metrics.annualizedReturn, catCode);
    const riskLevel = determineRiskLevel(catCode, f.name);
    const spark = Array.isArray(row.sparkline)
      ? (row.sparkline as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n))
      : [];

    return {
      fundId: f.id,
      code: f.code,
      name: f.name,
      shortName: f.shortName,
      logoUrl: getFundLogoUrlForUi(f.id, f.code, f.logoUrl, f.name),
      lastPrice: row.latestPrice > 0 ? row.latestPrice : f.lastPrice,
      dailyReturn: row.return1d,
      monthlyReturn: f.monthlyReturn !== 0 ? f.monthlyReturn : row.return30d ?? 0,
      yearlyReturn: row.return1y ?? f.yearlyReturn,
      portfolioSize: f.portfolioSize,
      investorCount: f.investorCount,
      category: f.category,
      fundType: fundTypeForApi(f.fundType),
      finalScore,
      riskLevel,
      scores,
      metrics,
      alpha,
      sparkline: spark.length > 0 ? spark : [f.lastPrice].filter((p) => p > 0),
    };
  });

  return {
    mode,
    total: funds.length,
    funds,
    ...(q ? { appliedQuery: q } : {}),
  };
}

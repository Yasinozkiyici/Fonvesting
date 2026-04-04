import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  calculateAllMetrics,
  generateSparklineData,
  calculateNormalizedScores,
  calculateFinalScore,
  determineRiskLevel,
  calculateAlpha,
  type FundMetrics,
  type FundScore,
  type RankingMode,
  type PricePoint,
} from "@/lib/scoring";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Vercel Pro+: uzun süren skor hesabı için (Hobby varsayılan ~10s yetersiz kalabilir). */
export const maxDuration = 60;

interface FundWithHistory {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  lastPrice: number;
  dailyReturn: number;
  portfolioSize: number;
  investorCount: number;
  categoryId: string | null;
  category: { code: string; name: string } | null;
  priceHistory: Array<{ date: Date; price: number }>;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = (searchParams.get("mode") || "BEST") as RankingMode;
    const categoryCode = searchParams.get("category");

    // Fetch funds with price history (last 7 days for sparkline)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const whereClause: Record<string, unknown> = { isActive: true };
    if (categoryCode) {
      whereClause.category = { code: categoryCode };
    }

    // Fetch ALL funds (no limit)
    const funds = await prisma.fund.findMany({
      where: whereClause,
      select: {
        id: true,
        code: true,
        name: true,
        shortName: true,
        logoUrl: true,
        lastPrice: true,
        dailyReturn: true,
        portfolioSize: true,
        investorCount: true,
        categoryId: true,
        category: { select: { code: true, name: true } },
        priceHistory: {
          where: { date: { gte: sevenDaysAgo } },
          orderBy: { date: "asc" },
          select: { date: true, price: true },
        },
      },
      orderBy: { portfolioSize: "desc" },
    }) as FundWithHistory[];

    // Calculate metrics for all funds
    const fundsWithMetrics: Array<{
      fund: FundWithHistory;
      metrics: FundMetrics;
      pricePoints: PricePoint[];
    }> = [];

    for (const fund of funds) {
      // Convert price history to PricePoint format
      const pricePoints: PricePoint[] = fund.priceHistory.map((h) => ({
        date: h.date,
        price: h.price,
      }));

      // If no history, use current price with simulated minimal data
      if (pricePoints.length === 0 && fund.lastPrice > 0) {
        const now = new Date();
        pricePoints.push({ date: now, price: fund.lastPrice });
      }

      const metrics = calculateAllMetrics(pricePoints);
      
      // Use daily return from DB if we don't have enough history
      if (metrics.dataPoints < 2 && fund.dailyReturn !== 0) {
        metrics.annualizedReturn = fund.dailyReturn * 252; // Rough annualization
        metrics.totalReturn = fund.dailyReturn;
      }

      fundsWithMetrics.push({ fund, metrics, pricePoints });
    }

    // Get all metrics for normalization
    const allMetrics = fundsWithMetrics.map((f) => f.metrics);

    // Calculate scores for each fund
    const scoredFunds: FundScore[] = fundsWithMetrics.map(({ fund, metrics, pricePoints }) => {
      const scores = calculateNormalizedScores(metrics, allMetrics);
      const finalScore = calculateFinalScore(scores, mode);
      
      // Use category-based risk level determination
      const riskLevel = determineRiskLevel(
        fund.category?.code || "DGR",
        fund.name
      );
      
      const alpha = calculateAlpha(
        metrics.annualizedReturn,
        fund.category?.code || "DGR"
      );
      
      // Generate sparkline - use price history if available, otherwise create realistic simulation
      let sparkline: number[];
      if (pricePoints.length >= 3) {
        sparkline = generateSparklineData(
          pricePoints.map((p) => p.price),
          7
        );
      } else if (fund.lastPrice > 0) {
        // Create realistic sparkline simulation based on daily return and volatility
        // Use fund code as seed for consistent but varied patterns
        const seed = fund.code.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
        const dailyReturn = fund.dailyReturn / 100; // Convert to decimal
        const volatility = Math.abs(dailyReturn) * 2 + 0.002; // Base volatility
        
        // Generate 7 days of realistic price movement
        const prices: number[] = [];
        let currentPrice = fund.lastPrice / (1 + dailyReturn * 0.7); // Start price ~7 days ago
        
        for (let i = 0; i < 7; i++) {
          prices.push(currentPrice);
          // Add daily change with some randomness based on seed
          const seedFactor = Math.sin(seed * (i + 1) * 0.7) * 0.5 + 0.5;
          const dayChange = dailyReturn / 7 + (seedFactor - 0.5) * volatility;
          currentPrice = currentPrice * (1 + dayChange);
        }
        
        // Ensure last price matches actual lastPrice
        const tail = prices.at(-1);
        const scaleFactor = tail && tail !== 0 ? fund.lastPrice / tail : 1;
        sparkline = prices.map((p) => p * scaleFactor);
      } else {
        sparkline = [];
      }

      return {
        fundId: fund.id,
        code: fund.code,
        name: fund.name,
        shortName: fund.shortName,
        logoUrl: getFundLogoUrlForUi(fund.id, fund.code, fund.logoUrl, fund.name),
        lastPrice: fund.lastPrice,
        dailyReturn: fund.dailyReturn,
        portfolioSize: fund.portfolioSize,
        investorCount: fund.investorCount,
        category: fund.category,
        finalScore,
        riskLevel,
        scores,
        metrics,
        alpha,
        sparkline,
      };
    });

    // Sort by final score
    scoredFunds.sort((a, b) => b.finalScore - a.finalScore);

    return NextResponse.json({
      mode,
      total: scoredFunds.length,
      funds: scoredFunds,
    });
  } catch (error) {
    console.error("[scores] Error:", error);
    return NextResponse.json(
      { error: "Failed to calculate scores" },
      { status: 500 }
    );
  }
}

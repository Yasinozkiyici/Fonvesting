import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import {
  calculateAllMetrics,
  determineRiskLevel,
  type FundMetrics,
  type PricePoint,
  type RiskLevel,
} from "@/lib/scoring";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import { fundTypeDisplayLabel } from "@/lib/fund-type-display";

const HISTORY_CAP = 2500;

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

const RISK_LEVELS: RiskLevel[] = ["very_low", "low", "medium", "high", "very_high"];

function parseRiskLevel(raw: string | null | undefined): RiskLevel | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim() as RiskLevel;
  return RISK_LEVELS.includes(s) ? s : null;
}

function parseFundMetricsJson(value: unknown): FundMetrics | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k] as number) ? (o[k] as number) : null);
  if (n("volatility") == null && n("maxDrawdown") == null) return null;
  return {
    totalReturn: n("totalReturn") ?? 0,
    annualizedReturn: n("annualizedReturn") ?? 0,
    volatility: n("volatility") ?? 0,
    maxDrawdown: n("maxDrawdown") ?? 0,
    sharpeRatio: n("sharpeRatio") ?? 0,
    sortinoRatio: n("sortinoRatio") ?? 0,
    calmarRatio: n("calmarRatio") ?? 0,
    winRate: n("winRate") ?? 0,
    avgGain: n("avgGain") ?? 0,
    avgLoss: n("avgLoss") ?? 0,
    dataPoints: Math.round(n("dataPoints") ?? 0),
  };
}

export type FundDetailPricePoint = { t: number; p: number };

export type FundDetailPageData = {
  fund: {
    code: string;
    name: string;
    shortName: string | null;
    description: string | null;
    lastPrice: number;
    dailyReturn: number;
    portfolioSize: number;
    investorCount: number;
    category: { code: string; name: string } | null;
    fundType: { code: number; name: string } | null;
    logoUrl: string | null;
  };
  snapshotDate: string | null;
  riskLevel: RiskLevel | null;
  snapshotMetrics: FundMetrics | null;
  priceSeries: FundDetailPricePoint[];
  /** Tam seri üzerinden hesaplanan metrikler (grafikten bağımsız özet). */
  historyMetrics: FundMetrics | null;
  bestWorstDay: { bestPct: number; worstPct: number } | null;
};

function bestWorstDailyReturn(
  rows: Array<{ dailyReturn: number }>
): { bestPct: number; worstPct: number } | null {
  let best = -Infinity;
  let worst = Infinity;
  for (const r of rows) {
    const v = r.dailyReturn;
    if (!Number.isFinite(v) || v === 0) continue;
    if (v > best) best = v;
    if (v < worst) worst = v;
  }
  if (!Number.isFinite(best) || !Number.isFinite(worst)) return null;
  return { bestPct: best, worstPct: worst };
}

export async function getFundDetailPageData(rawCode: string): Promise<FundDetailPageData | null> {
  const trimmed = rawCode.trim();
  if (!trimmed) return null;

  const fund = await prisma.fund.findFirst({
    where: { code: { equals: trimmed, mode: "insensitive" } },
    select: {
      id: true,
      code: true,
      name: true,
      shortName: true,
      description: true,
      logoUrl: true,
      lastPrice: true,
      dailyReturn: true,
      portfolioSize: true,
      investorCount: true,
      category: { select: { code: true, name: true } },
      fundType: { select: { code: true, name: true } },
    },
  });

  if (!fund) return null;

  const [historyRows, latestSnap] = await Promise.all([
    prisma.fundPriceHistory.findMany({
      where: { fundId: fund.id },
      orderBy: { date: "desc" },
      take: HISTORY_CAP,
      select: { date: true, price: true, dailyReturn: true },
    }),
    prisma.fundDailySnapshot.findFirst({
      where: { fundId: fund.id },
      orderBy: { date: "desc" },
      select: { date: true, riskLevel: true, metrics: true },
    }),
  ]);

  const ascHistory = [...historyRows].reverse();
  const points = dedupeSessionPricePoints(ascHistory.map((r) => ({ date: r.date, price: r.price })));
  const priceSeries: FundDetailPricePoint[] = points.map((pt) => ({
    t: pt.date.getTime(),
    p: pt.price,
  }));

  const historyMetrics = points.length >= 2 ? calculateAllMetrics(points) : null;
  const bestWorstDay =
    ascHistory.length > 0 ? bestWorstDailyReturn(ascHistory.map((r) => ({ dailyReturn: r.dailyReturn }))) : null;

  const snapshotMetrics = latestSnap ? parseFundMetricsJson(latestSnap.metrics) : null;
  const riskFromSnap = latestSnap ? parseRiskLevel(latestSnap.riskLevel) : null;
  const categoryCode = fund.category?.code ?? "";
  const riskLevel =
    riskFromSnap ?? determineRiskLevel(categoryCode, fund.name);

  const ft = fund.fundType;
  const fundTypeResolved = ft
    ? { code: ft.code, name: fundTypeDisplayLabel({ code: ft.code, name: ft.name }) }
    : null;

  return {
    fund: {
      code: fund.code,
      name: fund.name,
      shortName: fund.shortName,
      description: fund.description,
      lastPrice: fund.lastPrice,
      dailyReturn: fund.dailyReturn,
      portfolioSize: fund.portfolioSize,
      investorCount: fund.investorCount,
      category: fund.category,
      fundType: fundTypeResolved,
      logoUrl: getFundLogoUrlForUi(fund.id, fund.code, fund.logoUrl, fund.name),
    },
    snapshotDate: latestSnap?.date ? latestSnap.date.toISOString() : null,
    riskLevel,
    snapshotMetrics,
    priceSeries,
    historyMetrics,
    bestWorstDay,
  };
}

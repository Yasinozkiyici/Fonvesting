import type { FundDetailCoreServingPayload } from "@/lib/services/fund-detail-core-serving.service";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeServingDetailPayload(value: unknown): FundDetailCoreServingPayload | null {
  const root = asRecord(value);
  if (!root) return null;
  const fund = asRecord(root.fund);
  const chartHistory = asRecord(root.chartHistory);
  if (!fund || !chartHistory) return null;
  const code = asString(fund.code);
  const name = asString(fund.name);
  if (!code || !name) return null;
  const pointsRaw = Array.isArray(chartHistory.points) ? chartHistory.points : [];
  const points = pointsRaw
    .map((point) => {
      const row = asRecord(point);
      if (!row) return null;
      const t = asNumber(row.t);
      const p = asNumber(row.p);
      if (t == null || p == null || p <= 0) return null;
      return { t, p, d: null, i: null, s: null };
    })
    .filter((row): row is { t: number; p: number; d: null; i: null; s: null } => row != null);
  return {
    version: asNumber(root.version) ?? 1,
    generatedAt: asString(root.generatedAt) ?? new Date().toISOString(),
    sourceDate: asString(root.sourceDate),
    fund: {
      fundId: asString(fund.fundId) ?? code,
      code,
      name,
      shortName: asString(fund.shortName),
      logoUrl: asString(fund.logoUrl),
      categoryCode: asString(fund.categoryCode),
      categoryName: asString(fund.categoryName),
      fundTypeCode: asNumber(fund.fundTypeCode),
      fundTypeName: asString(fund.fundTypeName),
    },
    latestSnapshotDate: asString(root.latestSnapshotDate),
    latestPrice: asNumber(root.latestPrice) ?? 0,
    dailyChangePct: asNumber(root.dailyChangePct) ?? 0,
    monthlyReturn: asNumber(root.monthlyReturn) ?? 0,
    yearlyReturn: asNumber(root.yearlyReturn) ?? 0,
    snapshotAlpha: asNumber(root.snapshotAlpha),
    riskLevel: asString(root.riskLevel),
    snapshotMetrics: asRecord(root.snapshotMetrics) ?? {},
    miniPriceSeries: [],
    chartHistory: {
      mode: asString(chartHistory.mode) ?? "history",
      lookbackDays: asNumber(chartHistory.lookbackDays) ?? 1125,
      minDate: asString(chartHistory.minDate),
      maxDate: asString(chartHistory.maxDate),
      points,
    },
    investorSummary: {
      current: asNumber(asRecord(root.investorSummary)?.current) ?? 0,
      delta: null,
      min: null,
      max: null,
      series: [],
    },
    portfolioSummary: {
      current: asNumber(asRecord(root.portfolioSummary)?.current) ?? 0,
      delta: null,
      min: null,
      max: null,
      series: [],
    },
  };
}

export function toServingDetailMap(
  rows: Array<{ fundCode: string; payload: unknown }>
): Map<string, FundDetailCoreServingPayload> {
  const out = new Map<string, FundDetailCoreServingPayload>();
  for (const row of rows) {
    const normalized = normalizeServingDetailPayload(row.payload);
    if (!normalized) continue;
    out.set(row.fundCode.trim().toUpperCase(), normalized);
  }
  return out;
}


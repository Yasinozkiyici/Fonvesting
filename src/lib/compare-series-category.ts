import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import type { FundDetailCoreServingPayload } from "@/lib/services/fund-detail-core-serving.service";

export type CompareSeriesPoint = { t: number; v: number };

export function normalizeCompareHistoryDate(date: Date): Date {
  return startOfUtcDay(new Date(date.getTime() + 3 * 60 * 60 * 1000));
}

export function pointsFromServingPayload(payload: FundDetailCoreServingPayload): CompareSeriesPoint[] {
  const rows = payload.chartHistory?.points ?? [];
  const map = new Map<number, number>();
  for (const row of rows) {
    if (!Number.isFinite(row?.t) || !Number.isFinite(row?.p) || row.p <= 0) continue;
    map.set(normalizeCompareHistoryDate(new Date(row.t)).getTime(), row.p);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t, v }));
}

export function buildCategorySeriesFromServingPayloads(
  base: FundDetailCoreServingPayload,
  universe: FundDetailCoreServingPayload[]
): CompareSeriesPoint[] {
  const categoryCode = base.fund.categoryCode;
  if (!categoryCode) return [];
  const baseCode = base.fund.code.trim().toUpperCase();
  const byDate = new Map<number, { sum: number; count: number }>();
  let contributors = 0;
  for (const payload of universe) {
    if (payload.fund.code.trim().toUpperCase() === baseCode) continue;
    if (payload.fund.categoryCode !== categoryCode) continue;
    const series = pointsFromServingPayload(payload);
    if (series.length < 2) continue;
    contributors += 1;
    for (let index = 1; index < series.length; index += 1) {
      const prev = series[index - 1]!;
      const curr = series[index]!;
      if (!(prev.v > 0)) continue;
      const dailyReturnPct = ((curr.v - prev.v) / prev.v) * 100;
      if (!Number.isFinite(dailyReturnPct)) continue;
      const slot = byDate.get(curr.t) ?? { sum: 0, count: 0 };
      slot.sum += dailyReturnPct;
      slot.count += 1;
      byDate.set(curr.t, slot);
    }
  }
  if (contributors === 0 || byDate.size === 0) return [];
  const sorted = [...byDate.entries()].sort((a, b) => a[0] - b[0]);
  let index = 100;
  const out: CompareSeriesPoint[] = [];
  for (const [t, agg] of sorted) {
    if (agg.count <= 0) continue;
    index *= 1 + agg.sum / agg.count / 100;
    out.push({ t, v: index });
  }
  return out;
}

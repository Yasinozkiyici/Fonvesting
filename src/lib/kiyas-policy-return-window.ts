import { sampleOnOrBefore } from "@/lib/kiyas-macro-window";

/**
 * Politika faizi penceresi getirisi — Prisma bağımlılığı yok (unit test / client güvenli).
 * Sunucu `fund-detail-kiyas.service` içindeki policyScaledReturnPct ile aynı matematik.
 */
const DAY_MS = 86_400_000;
const MAX_POLICY_STALENESS_DAYS = 180;

function policyScaledReturnPct(
  sorted: Array<{ date: Date; value: number }>,
  anchor: Date,
  days: number
): number | null {
  const annualRateSample = sampleOnOrBefore(sorted, anchor);
  if (!annualRateSample) return null;
  if (annualRateSample.date.getTime() < anchor.getTime() - MAX_POLICY_STALENESS_DAYS * DAY_MS) return null;
  if (annualRateSample.value <= -100) return null;
  const gross = 1 + annualRateSample.value / 100;
  if (!Number.isFinite(gross) || gross <= 0) return null;
  return (gross ** (days / 365) - 1) * 100;
}

export function kiyasPolicyReturnPctForWindow(
  points: Array<{ t: number; v: number }>,
  startT: number,
  endT: number
): number | null {
  if (points.length === 0 || !Number.isFinite(startT) || !Number.isFinite(endT) || endT <= startT) return null;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const asDates = sorted.map((p) => ({ date: new Date(p.t), value: p.v }));
  const anchor = new Date(endT);
  const days = Math.max(1, Math.round((endT - startT) / DAY_MS));
  return policyScaledReturnPct(asDates, anchor, days);
}

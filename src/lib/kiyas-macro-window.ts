const DAY_MS = 86_400_000;

type MacroPoint = { date: Date; value: number };

export function sampleOnOrBefore(
  sorted: MacroPoint[],
  t: Date
): { index: number; date: Date; value: number } | null {
  if (sorted.length === 0) return null;
  let lo = 0;
  let hi = sorted.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const td = sorted[mid]!.date.getTime();
    if (td <= t.getTime()) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ans < 0) return null;
  const row = sorted[ans]!;
  if (!Number.isFinite(row.value)) return null;
  return { index: ans, date: row.date, value: row.value };
}

function addUtcDays(d: Date, days: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export function macroTotalReturnPctForWindow(
  sorted: MacroPoint[],
  anchor: Date,
  days: number,
  maxStalenessDays: number
): number | null {
  const end = anchor;
  const startTarget = addUtcDays(anchor, -days);
  const endSample = sampleOnOrBefore(sorted, end);
  const startSample = sampleOnOrBefore(sorted, startTarget);
  if (!endSample || !startSample) return null;
  if (endSample.value <= 0 || startSample.value <= 0) return null;
  if (endSample.index === startSample.index) return null;
  const staleCutoffMs = end.getTime() - maxStalenessDays * DAY_MS;
  if (endSample.date.getTime() < staleCutoffMs) return null;
  return (endSample.value / startSample.value - 1) * 100;
}


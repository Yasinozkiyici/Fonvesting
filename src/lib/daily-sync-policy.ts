import { startOfUtcDay } from "@/lib/trading-calendar-tr";

export const ISTANBUL_TIME_ZONE = "Europe/Istanbul";
export const DAILY_SOURCE_REFRESH_CUTOFF_MINUTES = 20 * 60;
export const DAILY_JOB_SLA_MINUTES = {
  sourceRefresh: DAILY_SOURCE_REFRESH_CUTOFF_MINUTES + 8,
  servingRebuild: DAILY_SOURCE_REFRESH_CUTOFF_MINUTES + 22,
  warmScores: DAILY_SOURCE_REFRESH_CUTOFF_MINUTES + 36,
} as const;

export type IstanbulWallClock = {
  dateKey: string;
  minutesOfDay: number;
};

function getPart(parts: Intl.DateTimeFormatPart[], type: string, fallback = "00"): string {
  return parts.find((part) => part.type === type)?.value ?? fallback;
}

export function getIstanbulWallClock(now: Date = new Date()): IstanbulWallClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ISTANBUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const year = getPart(parts, "year");
  const month = getPart(parts, "month");
  const day = getPart(parts, "day");
  const hour = Number(getPart(parts, "hour"));
  const minute = Number(getPart(parts, "minute"));

  return {
    dateKey: `${year}-${month}-${day}`,
    minutesOfDay: hour * 60 + minute,
  };
}

export function toIstanbulDateKey(date: Date | null | undefined): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ISTANBUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function previousBusinessDay(anchor: Date): Date {
  const cursor = startOfUtcDay(anchor);
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return cursor;
}

export function latestExpectedBusinessSessionDate(
  now: Date = new Date(),
  cutoffMinutes: number = DAILY_SOURCE_REFRESH_CUTOFF_MINUTES
): Date {
  const wallClock = getIstanbulWallClock(now);
  const cursor = startOfUtcDay(now);

  if (wallClock.minutesOfDay < cutoffMinutes) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return previousBusinessDay(cursor);
}

import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_SOURCE_REFRESH_CUTOFF_MINUTES,
  getIstanbulWallClock,
  latestExpectedBusinessSessionDate,
  toIstanbulDateKey,
} from "@/lib/daily-sync-policy";

test("latestExpectedBusinessSessionDate rolls back before 20:00 Istanbul", () => {
  const now = new Date("2026-04-10T16:30:00.000Z"); // 19:30 Istanbul
  const expected = latestExpectedBusinessSessionDate(now);
  assert.equal(toIstanbulDateKey(expected), "2026-04-09");
});

test("latestExpectedBusinessSessionDate uses same business day after 20:00 Istanbul", () => {
  const now = new Date("2026-04-10T17:30:00.000Z"); // 20:30 Istanbul
  const expected = latestExpectedBusinessSessionDate(now);
  assert.equal(toIstanbulDateKey(expected), "2026-04-10");
});

test("latestExpectedBusinessSessionDate skips weekend when cutoff falls on Monday", () => {
  const now = new Date("2026-04-13T15:45:00.000Z"); // Monday 18:45 Istanbul
  const expected = latestExpectedBusinessSessionDate(now);
  assert.equal(toIstanbulDateKey(expected), "2026-04-10");
});

test("getIstanbulWallClock exposes current Istanbul minute of day", () => {
  const now = new Date("2026-04-10T17:05:00.000Z"); // 20:05 Istanbul
  const wallClock = getIstanbulWallClock(now);
  assert.equal(wallClock.dateKey, "2026-04-10");
  assert.equal(wallClock.minutesOfDay, DAILY_SOURCE_REFRESH_CUTOFF_MINUTES + 5);
});

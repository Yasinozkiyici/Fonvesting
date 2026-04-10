import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export function isCronAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get("authorization") || "";
  const expected = `Bearer ${cronSecret}`;
  const provided = Buffer.from(authHeader);
  const target = Buffer.from(expected);
  if (provided.length !== target.length) return false;
  return timingSafeEqual(provided, target);
}

import { NextResponse } from "next/server";
import { getSystemHealthSnapshot } from "@/lib/system-health";
import { readFreshnessTruthCached } from "@/lib/services/freshness-truth.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function allowHealthDetail(headers: Headers): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const configuredSecret = process.env.HEALTH_SECRET?.trim();
  const provided = headers.get("x-health-secret")?.trim();
  if (configuredSecret && provided && provided === configuredSecret) return true;
  const cronSecret = process.env.CRON_SECRET?.trim();
  const auth = headers.get("authorization")?.trim() ?? "";
  return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
}

export async function GET(request: Request) {
  if (!allowHealthDetail(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const [snapshot, freshnessTruth] = await Promise.all([
    getSystemHealthSnapshot({ lightweight: false, includeExternalProbes: false }),
    readFreshnessTruthCached(),
  ]);

  return NextResponse.json({
    ok: snapshot.database.canConnect,
    checkedAt: snapshot.checkedAt,
    dailySync: snapshot.jobs.dailySync,
    dailySyncStatus: snapshot.jobs.dailySyncStatus,
    canonicalFreshnessTruth: freshnessTruth,
    canonicalDates: {
      snapshotAsOf: freshnessTruth.snapshotAsOf,
      servingSnapshotAsOf: freshnessTruth.servingSnapshotAsOf,
      chartSnapshotAsOf: freshnessTruth.chartSnapshotAsOf,
      comparisonSnapshotAsOf: freshnessTruth.comparisonSnapshotAsOf,
      rawSnapshotAsOf: freshnessTruth.rawSnapshotAsOf,
    },
    issues: snapshot.issues.filter((issue) => issue.code.startsWith("daily_sync")),
  });
}

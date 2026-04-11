import { NextResponse } from "next/server";
import { getSystemHealthSnapshot } from "@/lib/system-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = ["fra1"];

function hasDetailedHealthAccess(headers: Headers): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const configuredSecret = process.env.HEALTH_SECRET?.trim();
  const providedHealthSecret = headers.get("x-health-secret")?.trim();
  if (configuredSecret && providedHealthSecret && providedHealthSecret === configuredSecret) {
    return true;
  }

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;
  const authHeader = headers.get("authorization")?.trim() ?? "";
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  const isProduction = process.env.NODE_ENV === "production";
  const allowDetails = hasDetailedHealthAccess(request.headers);
  const snapshot = await getSystemHealthSnapshot({ includeExternalProbes: allowDetails });
  /** 503 yalnızca doğrudan DB erişimi yoksa; veri uyarıları/degrade durum 200 + gövdede açıklanır. */
  const statusCode = snapshot.database.canConnect ? 200 : 503;

  if (isProduction && !allowDetails) {
    return NextResponse.json(
      {
        ok: snapshot.ok,
        status: snapshot.status,
        service: "fonvesting",
        timestamp: snapshot.checkedAt,
        liveness: snapshot.database.canConnect,
        livenessDetail: snapshot.database.canConnect
          ? null
          : snapshot.database.diagnostics.failureCategory ?? "database_unreachable",
        database: {
          configured: snapshot.database.configured,
          engine: snapshot.database.engine,
          canConnect: snapshot.database.canConnect,
          diagnostics: {
            identicalAcrossPaths: snapshot.database.diagnostics.identicalAcrossPaths,
            failureCategory: snapshot.database.diagnostics.failureCategory,
          },
        },
        counts: {
          funds: snapshot.counts.funds,
          activeFunds: snapshot.counts.activeFunds,
        },
        freshness: {
          latestFundSnapshotDate: snapshot.freshness.latestFundSnapshotDate,
          latestMarketSnapshotDate: snapshot.freshness.latestMarketSnapshotDate,
          latestMacroObservationDate: snapshot.freshness.latestMacroObservationDate,
        },
        integrity: {
          macroSyncStatus: snapshot.integrity.macroSyncStatus,
          latestSnapshotCoverageGap: snapshot.integrity.latestSnapshotCoverageGap,
        },
        jobs: snapshot.jobs,
        issueCount: snapshot.issues.length,
      },
      { status: statusCode }
    );
  }

  return NextResponse.json(
    {
      ...snapshot,
      service: "fonvesting",
      timestamp: snapshot.checkedAt,
      hint: "Yerel: docker compose up -d ve .env/.env.local içinde PostgreSQL DATABASE_URL. Üretim: pnpm exec prisma migrate deploy.",
    },
    { status: statusCode }
  );
}

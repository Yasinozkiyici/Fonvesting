import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/jobs-auth";
import { sendOpsAlert } from "@/lib/ops-alerts";
import { getSystemHealthSnapshot } from "@/lib/system-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
export const preferredRegion = ["fra1"];

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const snapshot = await getSystemHealthSnapshot({ includeExternalProbes: true });
  if (!snapshot.ok) {
    await sendOpsAlert({
      title: "daily health check degraded",
      severity: "error",
      lines: snapshot.issues.slice(0, 8).map((issue) => `${issue.code}: ${issue.message}`),
    });
  }

  return NextResponse.json({
    ok: snapshot.ok,
    status: snapshot.status,
    issueCount: snapshot.issues.length,
    jobs: snapshot.jobs,
    freshness: snapshot.freshness,
  }, { status: snapshot.ok ? 200 : 503 });
}

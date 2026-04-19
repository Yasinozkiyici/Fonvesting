import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl } from "@/lib/data-freshness";
import { buildFundDetailComparisonSubsystem } from "@/lib/services/fund-detail-comparison-subsystem.service";
import {
  deriveFundDetailComparisonContract,
  type FundDetailComparisonPayload,
} from "@/lib/contracts/fund-detail-comparison-subsystem";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CODE_RE = /^[A-Z0-9]{2,12}$/;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const raw = (searchParams.get("code") ?? "").trim().toUpperCase();
  if (!raw || !CODE_RE.test(raw)) {
    return NextResponse.json(
      { error: "invalid_code", route: "/api/funds/comparison" },
      { status: 400 }
    );
  }

  const startedAt = Date.now();
  const built = await buildFundDetailComparisonSubsystem({ code: raw });
  const contract = deriveFundDetailComparisonContract({
    state:
      built.state === "ready"
        ? "ready"
        : built.state === "no_comparable_refs"
          ? "no_comparable_refs"
          : built.state === "degraded_timeout"
            ? "degraded_timeout"
            : built.state === "source_unavailable"
              ? "source_unavailable"
              : "error",
    block: built.block,
    freshness: built.freshness,
    degradedReason: built.degradedReason,
  });

  const body: FundDetailComparisonPayload = {
    code: raw,
    state:
      built.state === "ready"
        ? "ready"
        : built.state === "no_comparable_refs"
          ? "no_comparable_refs"
          : built.state === "degraded_timeout"
            ? "degraded_timeout"
            : built.state === "source_unavailable"
              ? "source_unavailable"
              : "error",
    contract,
    block: built.block,
    degradedReason: built.degradedReason,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: 200,
    headers: {
      "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
      "X-Comparison-State": body.state,
      "X-Comparison-Renderable": body.contract.renderable ? "1" : "0",
      "X-Comparison-Reason": body.contract.reason,
      "X-Comparison-Ms": String(Date.now() - startedAt),
      "X-Data-Freshness-State": built.freshness?.state ?? "degraded_outdated",
      "X-Data-Freshness-Reason": built.freshness?.reason ?? "asof_unknown",
      "X-Data-Freshness-As-Of": built.freshness?.asOf ?? "unknown",
      "X-Data-Freshness-Age-Ms":
        built.freshness?.ageMs == null ? "unknown" : String(built.freshness.ageMs),
    },
  });
}


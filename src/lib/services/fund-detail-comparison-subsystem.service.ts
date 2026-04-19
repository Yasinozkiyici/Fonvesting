import type { PricePoint } from "@/lib/scoring/metrics";
import { getFundDetailCoreServingCached } from "@/lib/services/fund-detail-core-serving.service";
import { buildFundKiyasBlock, type FundKiyasViewPayload } from "@/lib/services/fund-detail-kiyas.service";
import { deriveFreshnessContract, type FreshnessContract } from "@/lib/freshness-contract";
import { prisma } from "@/lib/prisma";

const COMPARISON_TIMEOUT_MS = Number(process.env.FUND_DETAIL_COMPARISON_TIMEOUT_MS ?? "5200");
const COMPARISON_FRESHNESS_FRESH_MS = Number(process.env.FUND_DETAIL_COMPARISON_FRESHNESS_FRESH_MS ?? 6 * 60 * 60_000);
const COMPARISON_FRESHNESS_STALE_MS = Number(process.env.FUND_DETAIL_COMPARISON_FRESHNESS_STALE_MS ?? 36 * 60 * 60_000);

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout_${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isTimeoutLike(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /timeout|timed out/i.test(msg);
}

export async function buildFundDetailComparisonSubsystem(input: {
  code: string;
}): Promise<{
  block: FundKiyasViewPayload | null;
  freshness: FreshnessContract | null;
  degradedReason: string | null;
  state: "ready" | "no_comparable_refs" | "degraded_timeout" | "source_unavailable" | "error";
}> {
  const code = input.code.trim().toUpperCase();
  const serving = await getFundDetailCoreServingCached(code).catch(() => null);
  if (!serving?.payload) {
    return { block: null, freshness: null, degradedReason: "core_serving_unavailable", state: "source_unavailable" };
  }

  const payload = serving.payload;
  const anchorDate = payload.latestSnapshotDate ? new Date(payload.latestSnapshotDate) : null;
  if (!anchorDate || !Number.isFinite(anchorDate.getTime())) {
    return { block: null, freshness: null, degradedReason: "missing_anchor_date", state: "source_unavailable" };
  }

  // Category id is not present in serving payload; resolve via DB (small, bounded query).
  const fundRow = await prisma.fund.findUnique({
    where: { code },
    select: { id: true, categoryId: true },
  }).catch(() => null);
  if (!fundRow?.id) {
    return { block: null, freshness: null, degradedReason: "fund_not_found", state: "source_unavailable" };
  }

  const points: PricePoint[] =
    payload.chartHistory?.points?.length
      ? payload.chartHistory.points
          .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.p) && p.p > 0)
          .map((p) => ({ date: new Date(p.t), price: p.p }))
      : [];

  const freshness = deriveFreshnessContract({
    asOf: payload.latestSnapshotDate ?? payload.sourceDate ?? null,
    freshTtlMs: COMPARISON_FRESHNESS_FRESH_MS,
    staleTtlMs: COMPARISON_FRESHNESS_STALE_MS,
  });

  try {
    const block = await withTimeout(
      buildFundKiyasBlock({
        fundId: payload.fund.fundId || fundRow.id,
        categoryId: fundRow.categoryId,
        categoryCode: payload.fund.categoryCode,
        fundName: payload.fund.name,
        fundTypeCode: payload.fund.fundTypeCode,
        anchorDate,
        derived: {
          return30d: null,
          return90d: null,
          return180d: null,
          return1y: null,
          return2y: null,
          return3y: null,
        },
        pricePoints: points,
      }),
      COMPARISON_TIMEOUT_MS,
      "fund_detail_comparison"
    );
    if (!block) {
      return { block: null, freshness, degradedReason: "no_comparable_refs", state: "no_comparable_refs" };
    }
    return { block, freshness, degradedReason: null, state: "ready" };
  } catch (error) {
    if (isTimeoutLike(error)) {
      return { block: null, freshness, degradedReason: "timeout", state: "degraded_timeout" };
    }
    return { block: null, freshness, degradedReason: "exception", state: "error" };
  }
}


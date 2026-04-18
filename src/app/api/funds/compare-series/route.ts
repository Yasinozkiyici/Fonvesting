import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl, readCompareDataVersion } from "@/lib/data-freshness";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import { fetchKiyasMacroBuckets } from "@/lib/services/fund-detail-kiyas.service";
import {
  normalizeBaseCode,
  parseCompareCodes,
  readServingPayloadForCompareSeries,
} from "@/lib/services/compare-series-resolution";
import type { FundDetailCoreServingPayload } from "@/lib/services/fund-detail-core-serving.service";
import { buildCategorySeriesFromServingPayloads, normalizeCompareHistoryDate, pointsFromServingPayload } from "@/lib/compare-series-category";
import { optionalReferenceDegradation } from "@/lib/operational-hardening";
import { enforceServingRouteTrust, readServingComparePrimary, servingHeaders } from "@/lib/data-platform/read-side-serving";
import { readUiServingWorldMetaCached } from "@/lib/domain/serving/ui-cutover-contract";
import { isServingStrictModeEnabled, servingStrictHeaders } from "@/lib/data-platform/serving-strict-mode";
import { prisma } from "@/lib/prisma";
import { toServingDetailMap } from "@/lib/data-platform/compare-series-serving";
import { deriveFreshnessContract } from "@/lib/freshness-contract";
import { createComparePathTrace } from "@/lib/compare-path-instrumentation";
import { getFundDetailCoreServingCached } from "@/lib/services/fund-detail-core-serving.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CODES = 3;
const DAY_MS = 86_400_000;
const MAX_REF_SNAPSHOT_LAG_DAYS = Math.max(1, Math.min(5, Number(process.env.COMPARE_SERIES_MAX_REF_SNAPSHOT_LAG_DAYS ?? "2")));
const CODE_RE = /^[A-Z0-9]{2,12}$/;
const COMPARE_SERIES_VERSION_TIMEOUT_MS = Number(process.env.COMPARE_SERIES_VERSION_TIMEOUT_MS ?? "1000");
const COMPARE_SERIES_MACRO_TIMEOUT_MS = Math.max(3_200, Number(process.env.COMPARE_SERIES_MACRO_TIMEOUT_MS ?? "3600"));
const COMPARE_SERIES_CATEGORY_FALLBACK_MAX_FUNDS = Math.max(
  8,
  Math.min(40, Number(process.env.COMPARE_SERIES_CATEGORY_FALLBACK_MAX_FUNDS ?? "18"))
);
const COMPARE_SERIES_MACRO_TIMEOUT_COOLDOWN_MS = Number(
  process.env.COMPARE_SERIES_MACRO_TIMEOUT_COOLDOWN_MS ?? "60000"
);
const MIN_BASE_SERIES_POINTS = 30;
const MIN_SECONDARY_SERIES_POINTS = 8;
const COMPARE_SERIES_FRESHNESS_FRESH_MS = Number(process.env.COMPARE_SERIES_FRESHNESS_FRESH_MS ?? 6 * 60 * 60_000);
const COMPARE_SERIES_FRESHNESS_STALE_MS = Number(process.env.COMPARE_SERIES_FRESHNESS_STALE_MS ?? 36 * 60 * 60_000);
const COMPARE_SERIES_DETAIL_DB_TIMEOUT_MS = Number(process.env.COMPARE_SERIES_DETAIL_DB_TIMEOUT_MS ?? "2600");
const COMPARE_SERIES_DETAIL_CODE_READ_TIMEOUT_MS = Number(process.env.COMPARE_SERIES_DETAIL_CODE_READ_TIMEOUT_MS ?? "1900");
const COMPARE_SERIES_SERVING_COMPARE_TIMEOUT_MS = Number(process.env.COMPARE_SERIES_SERVING_COMPARE_TIMEOUT_MS ?? "2400");

type Point = { t: number; v: number };
type MacroBuckets = Awaited<ReturnType<typeof fetchKiyasMacroBuckets>>;

type CompareSeriesPayload = {
  fundSeries: Array<{ key: string; label: string; code: string; series: Point[] }>;
  macroSeries: {
    category: Point[];
    bist100: Point[];
    usdtry: Point[];
    eurtry: Point[];
    gold: Point[];
    policy: Point[];
  };
  labels: {
    category: string;
    bist100: string;
    usdtry: string;
    eurtry: string;
    gold: string;
    policy: string;
  };
};

type CompareSeriesBuildResult = {
  payload: CompareSeriesPayload;
  degraded: boolean;
  degradedSources: string[];
  failureClass: string[];
  health: {
    baseSeriesHealth: "healthy" | "invalid";
    compareSeriesHealth: "healthy" | "degraded" | "invalid";
    trustAsFinal: boolean;
  };
};

type CompareSeriesBaseError = {
  error: "base_not_found";
  failureClass: string[];
};

async function readServingDetailsByCode(
  codes: string[]
): Promise<Map<string, FundDetailCoreServingPayload>> {
  const reads = await Promise.all(
    codes.map(async (code) => {
      try {
        const read = await withTimeout(
          readServingPayloadForCompareSeries(code, getFundDetailCoreServingCached),
          COMPARE_SERIES_DETAIL_CODE_READ_TIMEOUT_MS,
          "compare_series_detail_code"
        );
        return [code, read.payload] as const;
      } catch {
        return [code, null] as const;
      }
    })
  );
  const map = new Map<string, FundDetailCoreServingPayload>();
  for (const [code, payload] of reads) {
    if (payload) map.set(code, payload);
  }
  return map;
}

type CompareSeriesOptionalState = { macroCooldownUntil: number };

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout_${timeoutMs}ms`)), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function isTimeoutLike(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|aborted/i.test(message);
}

function getCompareSeriesOptionalState(): CompareSeriesOptionalState {
  const g = globalThis as typeof globalThis & { __compareSeriesOptionalState?: CompareSeriesOptionalState };
  if (!g.__compareSeriesOptionalState) g.__compareSeriesOptionalState = { macroCooldownUntil: 0 };
  return g.__compareSeriesOptionalState;
}

function emptyMacroBuckets(): MacroBuckets {
  return { category: [], bist100: [], usdtry: [], eurtry: [], gold: [], policy: [] };
}

async function readOptionalMacroBuckets(anchor: Date): Promise<{ macroByRef: MacroBuckets; degraded: { degradedSource: string; failureClass: string } | null }> {
  const state = getCompareSeriesOptionalState();
  if (state.macroCooldownUntil > Date.now()) {
    return { macroByRef: emptyMacroBuckets(), degraded: optionalReferenceDegradation("macro", { timeout: true }) };
  }
  try {
    return {
      macroByRef: await withTimeout(fetchKiyasMacroBuckets(anchor), COMPARE_SERIES_MACRO_TIMEOUT_MS, "compare_series_macro"),
      degraded: null,
    };
  } catch (error) {
    const timeout = isTimeoutLike(error);
    if (timeout) {
      state.macroCooldownUntil = Date.now() + Math.max(5_000, COMPARE_SERIES_MACRO_TIMEOUT_COOLDOWN_MS);
    }
    return { macroByRef: emptyMacroBuckets(), degraded: optionalReferenceDegradation("macro", { timeout }) };
  }
}

function readOptionalCategoryReferencePayloads(baseFund: FundDetailCoreServingPayload, allDetails: FundDetailCoreServingPayload[]) {
  if (!baseFund.fund.categoryCode) {
    return { records: [] as FundDetailCoreServingPayload[], degraded: null as { degradedSource: string; failureClass: string } | null };
  }
  const categoryCode = baseFund.fund.categoryCode;
  const baseCode = baseFund.fund.code.trim().toUpperCase();
  const categoryRows = allDetails
    .filter((payload) => payload.fund.categoryCode === categoryCode)
    .filter((payload) => payload.fund.code.trim().toUpperCase() !== baseCode)
    .filter((payload) => pointsFromServingPayload(payload).length >= 2)
    .slice(0, COMPARE_SERIES_CATEGORY_FALLBACK_MAX_FUNDS);
  if (categoryRows.length === 0) {
    return {
      records: [] as FundDetailCoreServingPayload[],
      degraded: { degradedSource: "category_universe_optional", failureClass: "category_universe_empty" },
    };
  }
  return { records: [baseFund, ...categoryRows], degraded: null };
}

async function getCompareSeriesPayload(input: {
  baseCode: string;
  compareCodes: string[];
  detailByCode: Map<string, FundDetailCoreServingPayload>;
  categoryDetails: FundDetailCoreServingPayload[];
}): Promise<CompareSeriesBuildResult | CompareSeriesBaseError> {
  const baseCode = input.baseCode;
  const compareCodes = input.compareCodes;
  const detailByCode = input.detailByCode;
  const baseFund = detailByCode.get(baseCode.trim().toUpperCase()) ?? null;
  if (!baseFund) return { error: "base_not_found", failureClass: [] };

  const degradedSources: string[] = [];
  const failureClass: string[] = [];
  const baseSnapshotMs = Date.parse(baseFund.latestSnapshotDate ?? "");
  const orderedSelected = compareCodes
    .map((code) => {
      const payload = detailByCode.get(code.trim().toUpperCase()) ?? null;
      if (!payload) {
        degradedSources.push(`secondary_missing:${code}`);
        failureClass.push("secondary_missing");
      }
      return payload;
    })
    .filter((payload): payload is FundDetailCoreServingPayload => payload != null)
    .filter((payload) => {
      if (!Number.isFinite(baseSnapshotMs)) return true;
      const refMs = Date.parse(payload.latestSnapshotDate ?? "");
      if (!Number.isFinite(refMs)) return false;
      const lagDays = Math.floor((baseSnapshotMs - refMs) / DAY_MS);
      if (lagDays > MAX_REF_SNAPSHOT_LAG_DAYS) {
        degradedSources.push(`secondary_lagged:${payload.fund.code}`);
        failureClass.push("secondary_lagged");
        return false;
      }
      return true;
    });

  const [macroResult, categoryReference] = await Promise.all([
    readOptionalMacroBuckets(startOfUtcDay(new Date())),
    Promise.resolve(readOptionalCategoryReferencePayloads(baseFund, input.categoryDetails)),
  ]);
  if (macroResult.degraded) {
    degradedSources.push(macroResult.degraded.degradedSource);
    failureClass.push(macroResult.degraded.failureClass);
  }
  if (categoryReference.degraded) {
    degradedSources.push(categoryReference.degraded.degradedSource);
    failureClass.push(categoryReference.degraded.failureClass);
  }

  const payload: CompareSeriesPayload = {
    fundSeries: [
      {
        key: `fund:${baseFund.fund.code}`,
        label: `${baseFund.fund.code} (Fon)`,
        code: baseFund.fund.code,
        series: pointsFromServingPayload(baseFund),
      },
      ...orderedSelected.map((fund) => ({
        key: `fund:${fund.fund.code}`,
        label: fund.fund.code,
        code: fund.fund.code,
        series: pointsFromServingPayload(fund),
      })),
    ],
    macroSeries: {
      category: categoryReference.records.length > 0 ? buildCategorySeriesFromServingPayloads(baseFund, categoryReference.records) : [],
      bist100: (macroResult.macroByRef.bist100 ?? []).map((x) => ({ t: normalizeCompareHistoryDate(x.date).getTime(), v: x.value })),
      usdtry: (macroResult.macroByRef.usdtry ?? []).map((x) => ({ t: normalizeCompareHistoryDate(x.date).getTime(), v: x.value })),
      eurtry: (macroResult.macroByRef.eurtry ?? []).map((x) => ({ t: normalizeCompareHistoryDate(x.date).getTime(), v: x.value })),
      gold: (macroResult.macroByRef.gold ?? []).map((x) => ({ t: normalizeCompareHistoryDate(x.date).getTime(), v: x.value })),
      policy: (macroResult.macroByRef.policy ?? []).map((x) => ({ t: normalizeCompareHistoryDate(x.date).getTime(), v: x.value })),
    },
    labels: {
      category: "Kategori Ortalaması",
      bist100: "BIST 100",
      usdtry: "USD/TRY",
      eurtry: "EUR/TRY",
      gold: "Altın",
      policy: "Faiz / Para Piyasası Eşiği",
    },
  };

  const baseSeriesPoints = payload.fundSeries[0]?.series.length ?? 0;
  const lowSecondary = payload.fundSeries.slice(1).some((item) => item.series.length < MIN_SECONDARY_SERIES_POINTS);
  const baseHealthy = baseSeriesPoints >= MIN_BASE_SERIES_POINTS;
  const compareSeriesHealth: "healthy" | "degraded" | "invalid" = !baseHealthy
    ? "invalid"
    : lowSecondary || degradedSources.length > 0 || failureClass.length > 0
      ? "degraded"
      : "healthy";
  return {
    payload,
    degraded: degradedSources.length > 0 || failureClass.length > 0,
    degradedSources: [...new Set(degradedSources)],
    failureClass: [...new Set(failureClass)],
    health: {
      baseSeriesHealth: baseHealthy ? "healthy" : "invalid",
      compareSeriesHealth,
      trustAsFinal: compareSeriesHealth === "healthy",
    },
  };
}

export async function GET(req: NextRequest) {
  const trace = createComparePathTrace("compare-series");
  try {
    const strictMode = isServingStrictModeEnabled(req);
    const w0 = performance.now();
    const servingWorldMeta = await readUiServingWorldMetaCached();
    trace.record(
      "serving_world_meta",
      Math.round(performance.now() - w0),
      servingWorldMeta.buildIds.fundDetail ? "ok" : "empty"
    );
    type ComparePrimaryEnv = Awaited<ReturnType<typeof readServingComparePrimary>>;
    let envelope: ComparePrimaryEnv | null = null;
    {
      const s0 = performance.now();
      try {
        envelope = await withTimeout(
          readServingComparePrimary(servingWorldMeta),
          COMPARE_SERIES_SERVING_COMPARE_TIMEOUT_MS,
          "compare_series_serving_compare_primary"
        );
        const ms = Math.round(performance.now() - s0);
        trace.record("serving_compare_primary", ms, envelope.payload ? "ok" : "empty");
      } catch (e) {
        const ms = Math.round(performance.now() - s0);
        trace.record(
          "serving_compare_primary",
          ms,
          isTimeoutLike(e) ? "timeout" : "error",
          isTimeoutLike(e) ? "db_or_serving_read" : undefined
        );
        envelope = null;
      }
    }
    const servingCompare: ComparePrimaryEnv =
      envelope ??
      ({
        world: servingWorldMeta,
        payload: null,
        trust: {
          trustAsFinal: false,
          degradedKind: "serving_payload_missing",
          degradedReason: "compare_primary_envelope_unavailable",
        },
        envelopeRead: "latest_updated",
      } satisfies ComparePrimaryEnv);
    const servingWorld = servingCompare.world ?? servingWorldMeta;
    const baseCode = normalizeBaseCode(req.nextUrl.searchParams.get("base"));
    if (!baseCode) {
      return NextResponse.json(
        { error: "base_required" },
        {
          status: 400,
          headers: trace.finish({ httpStatus: 400, classification: "client_base_required" }),
        }
      );
    }
    if (!CODE_RE.test(baseCode)) {
      return NextResponse.json(
        { error: "base_not_found" },
        {
          status: 404,
          headers: trace.finish({ httpStatus: 404, classification: "client_base_invalid" }),
        }
      );
    }
    const compareCodes = parseCompareCodes(req.nextUrl.searchParams.get("codes"), { maxCodes: MAX_CODES, codeRe: CODE_RE }).filter((c) => c !== baseCode);
    const compareUniverseCodes = new Set((servingCompare?.payload?.funds ?? []).map((item) => item.code.trim().toUpperCase()));
    const baseOutsideCompareUniverse = Boolean(servingCompare?.payload && !compareUniverseCodes.has(baseCode));
    const unknownCompareCode = compareCodes.find((code) => !compareUniverseCodes.has(code));
    {
      const v0 = performance.now();
      await withTimeout(readCompareDataVersion(), COMPARE_SERIES_VERSION_TIMEOUT_MS, "compare_series_version").catch(() => null);
      trace.record("compare_data_version", Math.round(performance.now() - v0), "ok");
    }
    const detailBuildId = servingWorld?.buildIds.fundDetail ?? null;
    if (!detailBuildId) {
      return NextResponse.json(
        { error: "serving_detail_build_missing" },
        {
          status: 503,
          headers: {
            ...trace.finish({ httpStatus: 503, classification: "detail_build_missing" }),
            ...servingHeaders({
              world: servingWorld,
              trust: { trustAsFinal: false, degradedKind: "serving_world_misaligned", degradedReason: "fund_detail_build_missing" },
              routeSource: "serving_fund_detail",
              fallbackUsed: true,
            }),
          },
        }
      );
    }

    const requestedCodes = [...new Set([baseCode, ...compareCodes].map((code) => code.trim().toUpperCase()))];
    const d0 = performance.now();
    const detailRows = await withTimeout(
      prisma.servingFundDetail.findMany({
        where: { buildId: detailBuildId, fundCode: { in: requestedCodes } },
        select: { fundCode: true, payload: true },
      }),
      COMPARE_SERIES_DETAIL_DB_TIMEOUT_MS,
      "compare_series_detail_rows"
    ).catch(() => []);
    trace.record(
      "detail_db_requested_codes",
      Math.round(performance.now() - d0),
      detailRows.length > 0 ? "ok" : "empty"
    );
    let detailByCode = toServingDetailMap(detailRows);
    if (detailByCode.size === 0) {
      // Live pressure guard: fallback to per-code serving reads instead of hard timeout.
      const f0 = performance.now();
      detailByCode = await readServingDetailsByCode(requestedCodes);
      trace.record(
        "detail_per_code_fallback",
        Math.round(performance.now() - f0),
        detailByCode.size > 0 ? "ok" : "empty"
      );
    }
    const basePayload = detailByCode.get(baseCode);
    const categoryPeerCodes =
      basePayload?.fund.categoryCode && servingCompare?.payload
        ? servingCompare.payload.funds
            .filter((item) => item.categoryCode === basePayload.fund.categoryCode)
            .map((item) => item.code.trim().toUpperCase())
            .filter((code) => code !== baseCode && !requestedCodes.includes(code))
            .slice(0, COMPARE_SERIES_CATEGORY_FALLBACK_MAX_FUNDS)
        : [];
    let categoryRows: typeof detailRows = [];
    if (categoryPeerCodes.length > 0) {
      const c0 = performance.now();
      categoryRows = await withTimeout(
        prisma.servingFundDetail.findMany({
          where: { buildId: detailBuildId, fundCode: { in: categoryPeerCodes } },
          select: { fundCode: true, payload: true },
        }),
        COMPARE_SERIES_DETAIL_DB_TIMEOUT_MS,
        "compare_series_category_rows"
      ).catch(() => []);
      trace.record(
        "detail_db_category_peers",
        Math.round(performance.now() - c0),
        categoryRows.length > 0 ? "ok" : "empty"
      );
    } else {
      trace.record("detail_db_category_peers", 0, "skipped");
    }
    const categoryDetails = [...toServingDetailMap(categoryRows).values()];
    const p0 = performance.now();
    const result = await getCompareSeriesPayload({
      baseCode,
      compareCodes,
      detailByCode,
      categoryDetails,
    });
    trace.record(
      "series_payload_build",
      Math.round(performance.now() - p0),
      "error" in result ? "error" : result.degraded ? "degraded" : "ok"
    );
    if ("error" in result) {
      const st = result.error === "base_not_found" ? 404 : 503;
      return NextResponse.json(
        { error: result.error },
        {
          status: st,
          headers: trace.finish({
            httpStatus: st,
            classification: result.error === "base_not_found" ? "base_payload_missing" : "series_build_failed",
            detailSource: result.error,
          }),
        }
      );
    }

    const servingCompareAlignmentIssue =
      unknownCompareCode != null
        ? `unknown_compare:${unknownCompareCode}`
        : baseOutsideCompareUniverse
          ? "base_outside_serving_compare_universe"
          : null;
    const servingCompareAlignmentDegraded = Boolean(servingCompareAlignmentIssue);

    const routeTrust = enforceServingRouteTrust({
      world: servingWorld,
      source: "serving_compare_inputs",
      requiredBuilds: ["compare", "fundList", "fundDetail", "system"],
      payloadAvailable: result.health.baseSeriesHealth === "healthy",
      fallbackUsed: servingCompareAlignmentDegraded || result.degraded,
      fallbackReason: servingCompareAlignmentIssue ?? (result.degraded ? result.degradedSources.join(",") || "degraded_compare_series" : null),
    });
    const strictTrust =
      result.health.trustAsFinal && routeTrust.trustAsFinal && !servingCompareAlignmentDegraded;
    const freshness = deriveFreshnessContract({
      asOf: basePayload?.latestSnapshotDate ?? servingCompare?.payload?.snapshotAsOf ?? null,
      freshTtlMs: COMPARE_SERIES_FRESHNESS_FRESH_MS,
      staleTtlMs: COMPARE_SERIES_FRESHNESS_STALE_MS,
      unknownAsDegraded: true,
    });
    if (strictMode && (!strictTrust || result.degraded || servingCompareAlignmentDegraded)) {
      const reason =
        servingCompareAlignmentIssue ?? ((routeTrust.degradedReason ?? result.degradedSources.join(",")) || "compare_series_not_final");
      return NextResponse.json(
        { error: "serving_strict_violation", route: "/api/funds/compare-series", reason },
        {
          status: 503,
          headers: {
            ...trace.finish({
              httpStatus: 503,
              classification: "strict_violation",
              failureClass: result.failureClass.join(","),
              detailSource: reason,
            }),
            ...servingHeaders({
              world: servingWorld,
              trust: { trustAsFinal: strictTrust, degradedKind: routeTrust.degradedKind, degradedReason: routeTrust.degradedReason },
              routeSource: "serving_fund_detail",
              fallbackUsed: servingCompareAlignmentDegraded || result.degraded,
            }),
            ...servingStrictHeaders({ enabled: strictMode, violated: true, reason }),
          },
        }
      );
    }

    const degradedSourceParts = [servingCompareAlignmentIssue, result.degradedSources.join(",")].filter(
      (part): part is string => typeof part === "string" && part.length > 0
    );
    const responseHeaders: Record<string, string> = {
      "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
      ...trace.finish({
        httpStatus: 200,
        classification: result.health.compareSeriesHealth === "healthy" ? "ok" : "degraded_response",
        failureClass: result.failureClass.length ? result.failureClass.join(",") : null,
        rowSource: result.degradedSources.length ? result.degradedSources.join(",") : null,
      }),
      ...(result.degraded ? { "X-Compare-Series-Degraded": "1" } : {}),
      ...(degradedSourceParts.length ? { "X-Compare-Series-Degraded-Source": degradedSourceParts.join("|") } : {}),
      ...(result.failureClass.length ? { "X-Compare-Series-Failure-Class": result.failureClass.join(",") } : {}),
      "X-Compare-Series-Base-Health": result.health.baseSeriesHealth,
      "X-Compare-Series-Health": result.health.compareSeriesHealth,
      "X-Compare-Series-Trust-Final": result.health.trustAsFinal ? "1" : "0",
      "X-Data-Freshness-State": freshness.state,
      "X-Data-Freshness-Reason": freshness.reason,
      "X-Data-Freshness-As-Of": freshness.asOf ?? "unknown",
      "X-Data-Freshness-Age-Ms": freshness.ageMs == null ? "unknown" : String(freshness.ageMs),
      ...servingStrictHeaders({ enabled: strictMode, violated: false }),
      ...servingHeaders({
        world: servingWorld,
        trust: { trustAsFinal: strictTrust, degradedKind: routeTrust.degradedKind, degradedReason: routeTrust.degradedReason },
        routeSource: "serving_fund_detail",
        fallbackUsed: servingCompareAlignmentDegraded || result.degraded,
      }),
    };

    return NextResponse.json(
      {
        ...result.payload,
        meta: {
          servingWorld,
          freshness,
          compareSeriesHealth: result.health.compareSeriesHealth,
          trustAsFinal: result.health.trustAsFinal && routeTrust.trustAsFinal && !servingCompareAlignmentDegraded,
        },
      },
      { headers: responseHeaders }
    );
  } catch (error) {
    if (isServingStrictModeEnabled(req)) {
      return NextResponse.json(
        { error: "serving_strict_violation", route: "/api/funds/compare-series", reason: "exception_requires_fallback" },
        {
          status: 503,
          headers: {
            ...trace.finish({
              httpStatus: 503,
              classification: "strict_exception",
              failureClass: "exception_requires_fallback",
            }),
            ...servingStrictHeaders({ enabled: true, violated: true, reason: "exception_requires_fallback" }),
          },
        }
      );
    }
    if (process.env.NODE_ENV !== "production") console.error("[funds/compare-series]", error);
    return NextResponse.json(
      { error: "compare_series_failed" },
      {
        status: 500,
        headers: trace.finish({
          httpStatus: 500,
          classification: "server_error",
          failureClass: isTimeoutLike(error) ? "timeout" : "compare_series_failed",
        }),
      }
    );
  }
}

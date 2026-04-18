import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl, readCompareDataVersion } from "@/lib/data-freshness";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import { fetchKiyasMacroBuckets } from "@/lib/services/fund-detail-kiyas.service";
import { normalizeBaseCode, parseCompareCodes } from "@/lib/services/compare-series-resolution";
import type { FundDetailCoreServingPayload } from "@/lib/services/fund-detail-core-serving.service";
import { buildCategorySeriesFromServingPayloads, normalizeCompareHistoryDate, pointsFromServingPayload } from "@/lib/compare-series-category";
import { optionalReferenceDegradation } from "@/lib/operational-hardening";
import { enforceServingRouteTrust, readServingComparePrimary, servingHeaders } from "@/lib/data-platform/read-side-serving";
import { isServingStrictModeEnabled, servingStrictHeaders } from "@/lib/data-platform/serving-strict-mode";
import { prisma } from "@/lib/prisma";
import { toServingDetailMap } from "@/lib/data-platform/compare-series-serving";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CODES = 3;
const DAY_MS = 86_400_000;
const MAX_REF_SNAPSHOT_LAG_DAYS = 1;
const CODE_RE = /^[A-Z0-9]{2,12}$/;
const ACTIVE_FUND_CODE_RE = /^[A-Z0-9]{2,4}$/;
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
  try {
    const strictMode = isServingStrictModeEnabled(req);
    const servingCompare = await readServingComparePrimary();
    const servingWorld = servingCompare.world;
    const baseCode = normalizeBaseCode(req.nextUrl.searchParams.get("base"));
    if (!baseCode) return NextResponse.json({ error: "base_required" }, { status: 400 });
    if (!ACTIVE_FUND_CODE_RE.test(baseCode)) return NextResponse.json({ error: "base_not_found" }, { status: 404 });
    const compareCodes = parseCompareCodes(req.nextUrl.searchParams.get("codes"), { maxCodes: MAX_CODES, codeRe: CODE_RE }).filter((c) => c !== baseCode);
    const compareUniverseCodes = new Set((servingCompare.payload?.funds ?? []).map((item) => item.code.trim().toUpperCase()));
    if (servingCompare.payload && !compareUniverseCodes.has(baseCode)) {
      return NextResponse.json(
        { error: "base_not_found" },
        {
          status: 404,
          headers: servingHeaders({
            world: servingWorld,
            trust: { trustAsFinal: false, degradedKind: "serving_payload_invalid", degradedReason: "base_missing_in_serving_compare_inputs" },
            routeSource: "serving_fund_detail",
            fallbackUsed: false,
          }),
        }
      );
    }
    const unknownCompareCode = compareCodes.find((code) => !compareUniverseCodes.has(code));
    await withTimeout(readCompareDataVersion(), COMPARE_SERIES_VERSION_TIMEOUT_MS, "compare_series_version").catch(() => null);
    const detailBuildId = servingWorld?.buildIds.fundDetail ?? null;
    if (!detailBuildId) {
      return NextResponse.json(
        { error: "serving_detail_build_missing" },
        {
          status: 503,
          headers: servingHeaders({
            world: servingWorld,
            trust: { trustAsFinal: false, degradedKind: "serving_world_misaligned", degradedReason: "fund_detail_build_missing" },
            routeSource: "serving_fund_detail",
            fallbackUsed: true,
          }),
        }
      );
    }

    const requestedCodes = [...new Set([baseCode, ...compareCodes].map((code) => code.trim().toUpperCase()))];
    const detailRows = await prisma.servingFundDetail.findMany({
      where: { buildId: detailBuildId, fundCode: { in: requestedCodes } },
      select: { fundCode: true, payload: true },
    });
    const detailByCode = toServingDetailMap(detailRows);
    const basePayload = detailByCode.get(baseCode);
    const categoryPeerCodes =
      basePayload?.fund.categoryCode && servingCompare.payload
        ? servingCompare.payload.funds
            .filter((item) => item.categoryCode === basePayload.fund.categoryCode)
            .map((item) => item.code.trim().toUpperCase())
            .filter((code) => code !== baseCode && !requestedCodes.includes(code))
            .slice(0, COMPARE_SERIES_CATEGORY_FALLBACK_MAX_FUNDS)
        : [];
    const categoryRows =
      categoryPeerCodes.length > 0
        ? await prisma.servingFundDetail.findMany({
            where: { buildId: detailBuildId, fundCode: { in: categoryPeerCodes } },
            select: { fundCode: true, payload: true },
          })
        : [];
    const categoryDetails = [...toServingDetailMap(categoryRows).values()];
    const result = await getCompareSeriesPayload({
      baseCode,
      compareCodes,
      detailByCode,
      categoryDetails,
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.error === "base_not_found" ? 404 : 503 });
    }

    const routeTrust = enforceServingRouteTrust({
      world: servingWorld,
      source: "serving_compare_inputs",
      requiredBuilds: ["compare", "fundList", "fundDetail", "system"],
      payloadAvailable: result.health.baseSeriesHealth === "healthy",
      fallbackUsed: Boolean(unknownCompareCode) || result.degraded,
      fallbackReason: unknownCompareCode ? `unknown_compare:${unknownCompareCode}` : (result.degraded ? result.degradedSources.join(",") || "degraded_compare_series" : null),
    });
    const strictTrust = result.health.trustAsFinal && routeTrust.trustAsFinal && !unknownCompareCode;
    if (strictMode && (!strictTrust || result.degraded || Boolean(unknownCompareCode))) {
      const reason = unknownCompareCode ? `unknown_compare:${unknownCompareCode}` : ((routeTrust.degradedReason ?? result.degradedSources.join(",")) || "compare_series_not_final");
      return NextResponse.json(
        { error: "serving_strict_violation", route: "/api/funds/compare-series", reason },
        {
          status: 503,
          headers: {
            ...servingHeaders({
              world: servingWorld,
              trust: { trustAsFinal: strictTrust, degradedKind: routeTrust.degradedKind, degradedReason: routeTrust.degradedReason },
              routeSource: "serving_fund_detail",
              fallbackUsed: Boolean(unknownCompareCode) || result.degraded,
            }),
            ...servingStrictHeaders({ enabled: strictMode, violated: true, reason }),
          },
        }
      );
    }

    return NextResponse.json(
      {
        ...result.payload,
        meta: {
          servingWorld,
          compareSeriesHealth: result.health.compareSeriesHealth,
          trustAsFinal: result.health.trustAsFinal && routeTrust.trustAsFinal && !unknownCompareCode,
        },
      },
      {
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
          ...(result.degraded ? { "X-Compare-Series-Degraded": "1" } : {}),
          ...(result.degradedSources.length ? { "X-Compare-Series-Degraded-Source": result.degradedSources.join(",") } : {}),
          ...(result.failureClass.length ? { "X-Compare-Series-Failure-Class": result.failureClass.join(",") } : {}),
          ...(unknownCompareCode ? { "X-Compare-Series-Degraded-Source": `unknown_compare:${unknownCompareCode}` } : {}),
          "X-Compare-Series-Base-Health": result.health.baseSeriesHealth,
          "X-Compare-Series-Health": result.health.compareSeriesHealth,
          "X-Compare-Series-Trust-Final": result.health.trustAsFinal ? "1" : "0",
          ...servingStrictHeaders({ enabled: strictMode, violated: false }),
          ...servingHeaders({
            world: servingWorld,
            trust: { trustAsFinal: strictTrust, degradedKind: routeTrust.degradedKind, degradedReason: routeTrust.degradedReason },
            routeSource: "serving_fund_detail",
            fallbackUsed: Boolean(unknownCompareCode) || result.degraded,
          }),
        },
      }
    );
  } catch (error) {
    if (isServingStrictModeEnabled(req)) {
      return NextResponse.json(
        { error: "serving_strict_violation", route: "/api/funds/compare-series", reason: "exception_requires_fallback" },
        { status: 503, headers: servingStrictHeaders({ enabled: true, violated: true, reason: "exception_requires_fallback" }) }
      );
    }
    if (process.env.NODE_ENV !== "production") console.error("[funds/compare-series]", error);
    return NextResponse.json({ error: "compare_series_failed" }, { status: 500 });
  }
}

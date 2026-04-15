import { NextRequest, NextResponse } from "next/server";
import { LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC, liveDataCacheControl, readCompareDataVersion } from "@/lib/data-freshness";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import { fetchKiyasMacroBuckets } from "@/lib/services/fund-detail-kiyas.service";
import {
  normalizeBaseCode,
  parseCompareCodes,
  readServingPayloadForCompareSeries,
  classifyCompareBaseAvailability,
  classifyRegistryProofAvailability,
  type CompareServingReaderLike,
} from "@/lib/services/compare-series-resolution";
import {
  getFundDetailCoreServingCached,
  getFundDetailCoreServingUniversePayloads,
  type FundDetailCoreServingPayload,
} from "@/lib/services/fund-detail-core-serving.service";
import {
  buildCategorySeriesFromServingPayloads,
  normalizeCompareHistoryDate,
  pointsFromServingPayload,
} from "@/lib/compare-series-category";
import { optionalReferenceDegradation } from "@/lib/operational-hardening";
import { readActiveRegistryFundByCodeWithMeta, type RegistryRow } from "@/lib/services/fund-registry-read.service";
import { getFundsPage, type FundListRow } from "@/lib/services/fund-list.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOOKBACK_DAYS = 1125;
const MAX_CODES = 3;
const DAY_MS = 86_400_000;
const MAX_REF_SNAPSHOT_LAG_DAYS = 1;
const CODE_RE = /^[A-Z0-9]{2,12}$/;
const ACTIVE_FUND_CODE_RE = /^[A-Z0-9]{2,4}$/;
const COMPARE_SERIES_VERSION_TIMEOUT_MS = Number(process.env.COMPARE_SERIES_VERSION_TIMEOUT_MS ?? "1000");
const COMPARE_SERIES_MACRO_TIMEOUT_MS = Math.max(
  3_200,
  Number(process.env.COMPARE_SERIES_MACRO_TIMEOUT_MS ?? "3600")
);
const COMPARE_SERIES_UNIVERSE_TIMEOUT_MS = Number(process.env.COMPARE_SERIES_UNIVERSE_TIMEOUT_MS ?? "2200");
const COMPARE_SERIES_CATEGORY_UNIVERSE_TIMEOUT_MS = Math.max(
  2_400,
  Number(process.env.COMPARE_SERIES_CATEGORY_UNIVERSE_TIMEOUT_MS ?? "2800")
);
const COMPARE_SERIES_CATEGORY_FALLBACK_TIMEOUT_MS = Math.max(
  1_400,
  Number(process.env.COMPARE_SERIES_CATEGORY_FALLBACK_TIMEOUT_MS ?? "2200")
);
const COMPARE_SERIES_CATEGORY_FALLBACK_PAYLOAD_TIMEOUT_MS = Math.max(
  5_200,
  Number(process.env.COMPARE_SERIES_CATEGORY_FALLBACK_PAYLOAD_TIMEOUT_MS ?? "5600")
);
const COMPARE_SERIES_CATEGORY_FALLBACK_MAX_FUNDS = Math.max(
  8,
  Math.min(40, Number(process.env.COMPARE_SERIES_CATEGORY_FALLBACK_MAX_FUNDS ?? "18"))
);
const COMPARE_SERIES_SECONDARY_TIMEOUT_MS = Number(process.env.COMPARE_SERIES_SECONDARY_TIMEOUT_MS ?? "2600");
const COMPARE_SERIES_BASE_TIMEOUT_MS = Number(process.env.COMPARE_SERIES_BASE_TIMEOUT_MS ?? "3200");
const COMPARE_SERIES_REGISTRY_TIMEOUT_MS = Number(process.env.COMPARE_SERIES_REGISTRY_TIMEOUT_MS ?? "2200");
const COMPARE_SERIES_REGISTRY_PROOF_TIMEOUT_MS = Number(
  process.env.COMPARE_SERIES_REGISTRY_PROOF_TIMEOUT_MS ?? "1600"
);
const COMPARE_SERIES_MACRO_TIMEOUT_COOLDOWN_MS = Number(
  process.env.COMPARE_SERIES_MACRO_TIMEOUT_COOLDOWN_MS ?? "60000"
);

type Point = { t: number; v: number };

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
};

type CompareSeriesBaseError = {
  error: "base_not_found" | "base_temporarily_unavailable";
  failureClass: string[];
};

type CompareUniverseLike = Awaited<ReturnType<typeof getFundDetailCoreServingUniversePayloads>>;
type MacroBuckets = Awaited<ReturnType<typeof fetchKiyasMacroBuckets>>;
type CompareSeriesOptionalState = {
  macroCooldownUntil: number;
};

type OptionalCategoryReferenceRead = {
  records: FundDetailCoreServingPayload[];
  degraded: { degradedSource: string; failureClass: string } | null;
  fallbackSource: "universe" | "category_funds_list" | "none";
};

function getCompareSeriesOptionalState(): CompareSeriesOptionalState {
  const g = globalThis as typeof globalThis & { __compareSeriesOptionalState?: CompareSeriesOptionalState };
  if (!g.__compareSeriesOptionalState) {
    g.__compareSeriesOptionalState = { macroCooldownUntil: 0 };
  }
  return g.__compareSeriesOptionalState;
}

function emptyMacroBuckets(): MacroBuckets {
  return {
    category: [],
    bist100: [],
    usdtry: [],
    eurtry: [],
    gold: [],
    policy: [],
  };
}

async function readOptionalMacroBuckets(
  anchor: Date,
  fetchMacro: typeof fetchKiyasMacroBuckets
): Promise<{ macroByRef: MacroBuckets; degraded: { degradedSource: string; failureClass: string } | null }> {
  const state = getCompareSeriesOptionalState();
  if (state.macroCooldownUntil > Date.now()) {
    return {
      macroByRef: emptyMacroBuckets(),
      degraded: optionalReferenceDegradation("macro", { timeout: true }),
    };
  }
  try {
    return {
      macroByRef: await withTimeout(fetchMacro(anchor), COMPARE_SERIES_MACRO_TIMEOUT_MS, "compare_series_macro"),
      degraded: null,
    };
  } catch (error) {
    const timeout = isTimeoutLike(error);
    if (timeout) {
      state.macroCooldownUntil = Date.now() + Math.max(5_000, COMPARE_SERIES_MACRO_TIMEOUT_COOLDOWN_MS);
    }
    return {
      macroByRef: emptyMacroBuckets(),
      degraded: optionalReferenceDegradation("macro", { timeout }),
    };
  }
}

function buildSyntheticServingPayloadFromRegistry(input: {
  fundId: string;
  code: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  categoryCode?: string | null;
  categoryName?: string | null;
  fundTypeCode?: number | null;
  fundTypeName?: string | null;
  lastPrice: number;
  dailyReturn: number;
  portfolioSize: number;
  investorCount: number;
}): FundDetailCoreServingPayload {
  const nowIso = new Date().toISOString();
  return {
    version: 1,
    generatedAt: nowIso,
    sourceDate: null,
    fund: {
      fundId: input.fundId,
      code: input.code,
      name: input.name,
      shortName: input.shortName,
      logoUrl: input.logoUrl,
      categoryCode: input.categoryCode ?? null,
      categoryName: input.categoryName ?? null,
      fundTypeCode: input.fundTypeCode ?? null,
      fundTypeName: input.fundTypeName ?? null,
    },
    latestSnapshotDate: null,
    latestPrice: input.lastPrice,
    dailyChangePct: input.dailyReturn,
    monthlyReturn: 0,
    yearlyReturn: 0,
    snapshotAlpha: null,
    riskLevel: null,
    snapshotMetrics: {},
    miniPriceSeries: [],
    chartHistory: {
      mode: "registry_fallback",
      lookbackDays: LOOKBACK_DAYS,
      minDate: null,
      maxDate: null,
      points: [],
    },
    investorSummary: {
      current: Math.max(0, Math.round(input.investorCount)),
      delta: null,
      min: null,
      max: null,
      series: [],
    },
    portfolioSummary: {
      current: input.portfolioSize > 0 ? input.portfolioSize : 0,
      delta: null,
      min: null,
      max: null,
      series: [],
    },
  };
}

function syntheticServingPayloadFromRegistryRow(row: RegistryRow): FundDetailCoreServingPayload {
  return buildSyntheticServingPayloadFromRegistry({
    fundId: row.id,
    code: row.code,
    name: row.name,
    shortName: row.shortName,
    logoUrl: row.logoUrl,
    lastPrice: row.lastPrice,
    dailyReturn: row.dailyReturn,
    portfolioSize: row.portfolioSize,
    investorCount: row.investorCount,
  });
}

function syntheticServingPayloadFromFundListRow(row: FundListRow): FundDetailCoreServingPayload {
  return buildSyntheticServingPayloadFromRegistry({
    fundId: row.id,
    code: row.code,
    name: row.name,
    shortName: row.shortName,
    logoUrl: row.logoUrl,
    categoryCode: row.category?.code ?? null,
    categoryName: row.category?.name ?? null,
    fundTypeCode: row.fundType?.code ?? null,
    fundTypeName: row.fundType?.name ?? null,
    lastPrice: row.lastPrice,
    dailyReturn: row.dailyReturn,
    portfolioSize: row.portfolioSize,
    investorCount: row.investorCount,
  });
}

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
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|aborted/i.test(message);
}

async function readCategoryServingPayloadsFromFundsList(input: {
  baseFund: FundDetailCoreServingPayload;
  readServing: CompareServingReader;
}): Promise<FundDetailCoreServingPayload[]> {
  const categoryCode = input.baseFund.fund.categoryCode;
  if (!categoryCode) return [];

  const page = await withTimeout(
    getFundsPage({
      page: 1,
      pageSize: COMPARE_SERIES_CATEGORY_FALLBACK_MAX_FUNDS + 4,
      category: categoryCode,
      sortField: "portfolioSize",
      sortDir: "desc",
    }),
    COMPARE_SERIES_CATEGORY_FALLBACK_TIMEOUT_MS,
    "compare_series_category_funds_list"
  );
  const baseCode = input.baseFund.fund.code.trim().toUpperCase();
  const codes = page.items
    .map((item) => item.code.trim().toUpperCase())
    .filter((code) => code && code !== baseCode)
    .slice(0, COMPARE_SERIES_CATEGORY_FALLBACK_MAX_FUNDS);

  const reads = await Promise.all(
    codes.map(async (code) => {
      try {
        const read = await withTimeout(
          readServingPayloadForCompareSeries(code, input.readServing),
          COMPARE_SERIES_CATEGORY_FALLBACK_PAYLOAD_TIMEOUT_MS,
          `compare_series_category_payload_${code}`
        );
        return read.payload;
      } catch {
        return null;
      }
    })
  );

  return reads.filter((payload): payload is FundDetailCoreServingPayload => {
    if (!payload) return false;
    return payload.fund.categoryCode === categoryCode && pointsFromServingPayload(payload).length >= 2;
  });
}

async function readOptionalCategoryReferencePayloads(input: {
  baseFund: FundDetailCoreServingPayload;
  getUniverse: () => Promise<CompareUniverseLike>;
  readServing: CompareServingReader;
}): Promise<OptionalCategoryReferenceRead> {
  if (!input.baseFund.fund.categoryCode) {
    return { records: [], degraded: null, fallbackSource: "none" };
  }

  let universeDegraded: { degradedSource: string; failureClass: string } | null = null;
  const universeTask = (async (): Promise<OptionalCategoryReferenceRead> => {
    const universe = await withTimeout(
      input.getUniverse(),
      COMPARE_SERIES_CATEGORY_UNIVERSE_TIMEOUT_MS,
      "compare_series_category_universe"
    );
    if (universe.records.length > 0) {
      return { records: universe.records, degraded: null, fallbackSource: "universe" };
    }
    throw new Error("compare_series_category_universe_empty");
  })().catch((error) => {
    universeDegraded = optionalReferenceDegradation("category_universe", { timeout: isTimeoutLike(error) });
    throw error;
  });

  const fallbackTask = (async (): Promise<OptionalCategoryReferenceRead> => {
    const fallbackRecords = await readCategoryServingPayloadsFromFundsList({
      baseFund: input.baseFund,
      readServing: input.readServing,
    });
    if (fallbackRecords.length === 0) {
      throw new Error("compare_series_category_fallback_empty");
    }
    return {
      records: [input.baseFund, ...fallbackRecords],
      degraded: { degradedSource: "category_universe_fallback", failureClass: "category_universe_fallback" },
      fallbackSource: "category_funds_list",
    };
  })();

  try {
    return await Promise.any([universeTask, fallbackTask]);
  } catch {
    return {
      records: [],
      degraded: universeDegraded ?? {
        degradedSource: "category_universe_optional",
        failureClass: "category_universe_empty",
      },
      fallbackSource: "none",
    };
  }
}

type CompareServingRead = Awaited<ReturnType<typeof getFundDetailCoreServingCached>>;
type CompareServingReader = CompareServingReaderLike<FundDetailCoreServingPayload>;

async function readBaseProofFromFundsList(code: string): Promise<{
  row: FundListRow | null;
  source: "funds_list" | "none";
  failureClass?: "funds_list_timeout" | "funds_list_failed";
}> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { row: null, source: "funds_list" };
  try {
    const page = await withTimeout(
      getFundsPage({
        page: 1,
        pageSize: 5,
        q: normalized,
        sortField: "portfolioSize",
        sortDir: "desc",
      }),
      COMPARE_SERIES_REGISTRY_PROOF_TIMEOUT_MS,
      "compare_series_funds_list_base_proof"
    );
    const row = page.items.find((item) => item.code.trim().toUpperCase() === normalized) ?? null;
    return { row, source: "funds_list" };
  } catch (error) {
    return {
      row: null,
      source: "none",
      failureClass: isTimeoutLike(error) ? "funds_list_timeout" : "funds_list_failed",
    };
  }
}

async function getCompareSeriesPayload(
  baseCode: string,
  compareCodes: string[],
  deps?: {
    readServing?: CompareServingReader;
    fetchMacro?: typeof fetchKiyasMacroBuckets;
    readUniverse?: typeof getFundDetailCoreServingUniversePayloads;
  }
): Promise<CompareSeriesBuildResult | CompareSeriesBaseError> {
  const readServing = deps?.readServing ?? getFundDetailCoreServingCached;
  const fetchMacro = deps?.fetchMacro ?? fetchKiyasMacroBuckets;
  const readUniverse = deps?.readUniverse ?? getFundDetailCoreServingUniversePayloads;
  let servingUniverse: CompareUniverseLike | null = null;
  const getUniverse = async (): Promise<CompareUniverseLike> => {
    if (servingUniverse) return servingUniverse;
    servingUniverse = await withTimeout(readUniverse(), COMPARE_SERIES_UNIVERSE_TIMEOUT_MS, "compare_series_universe");
    return servingUniverse;
  };
  const findFromUniverse = (code: string, universe: CompareUniverseLike | null): FundDetailCoreServingPayload | null => {
    if (!universe || universe.records.length === 0) return null;
    const normalized = code.trim().toUpperCase();
    return (
      universe.records.find((record) => record.fund.code.trim().toUpperCase() === normalized) ?? null
    );
  };

  const baseRegistryProof = await withTimeout(
    readActiveRegistryFundByCodeWithMeta(baseCode),
    COMPARE_SERIES_REGISTRY_PROOF_TIMEOUT_MS,
    "compare_series_registry_base_proof"
  ).catch((error) => ({
    row: null,
    source: "none" as const,
    failureClass: isTimeoutLike(error) ? "registry_timeout" as const : "registry_failed" as const,
    failureDetail: error instanceof Error ? error.message : String(error),
  }));

  if (
    classifyRegistryProofAvailability({
      rowExists: Boolean(baseRegistryProof.row),
      source: baseRegistryProof.source,
    }) === "not_found"
  ) {
    return { error: "base_not_found", failureClass: [] };
  }
  const baseFundsListProof =
    baseRegistryProof.row || baseRegistryProof.source !== "none"
      ? null
      : await readBaseProofFromFundsList(baseCode);
  if (baseFundsListProof?.source === "funds_list" && !baseFundsListProof.row) {
    return { error: "base_not_found", failureClass: [] };
  }

  const baseRead = await withTimeout(
    readServingPayloadForCompareSeries(baseCode, readServing),
    COMPARE_SERIES_BASE_TIMEOUT_MS,
    "compare_series_base_read"
  ).catch((error) => ({
    payload: null,
    missReason: isTimeoutLike(error) ? "read_timeout" : "read_failed",
  }));

  let baseFund: FundDetailCoreServingPayload | null = baseRead.payload;
  let baseFromRegistryFallback = false;
  if (!baseFund) {
    try {
      baseFund = findFromUniverse(baseCode, await getUniverse());
    } catch {
      // universe read failure below transient class branch'inde ele alınır
    }
  }
  if (!baseFund) {
    if (baseFundsListProof?.row) {
      baseFund = syntheticServingPayloadFromFundListRow(baseFundsListProof.row);
      baseFromRegistryFallback = true;
    }
  }
  if (!baseFund) {
    if (baseRegistryProof.row) {
      baseFund = syntheticServingPayloadFromRegistryRow(baseRegistryProof.row);
      baseFromRegistryFallback = true;
    } else if (baseRegistryProof.source === "none") {
      const registryFallback = await withTimeout(
        readActiveRegistryFundByCodeWithMeta(baseCode),
        COMPARE_SERIES_REGISTRY_TIMEOUT_MS,
        "compare_series_registry_base"
      ).catch((error) => ({
        row: null,
        source: "none" as const,
        failureClass: isTimeoutLike(error) ? "registry_timeout" as const : "registry_failed" as const,
        failureDetail: error instanceof Error ? error.message : String(error),
      }));
      if (registryFallback.row) {
        baseFund = syntheticServingPayloadFromRegistryRow(registryFallback.row);
        baseFromRegistryFallback = true;
      } else if (
        classifyRegistryProofAvailability({
          rowExists: Boolean(registryFallback.row),
          source: registryFallback.source,
        }) === "not_found"
      ) {
        return { error: "base_not_found", failureClass: [] };
      }
    }
  }
  if (!baseFund) {
    const availability = classifyCompareBaseAvailability({
      hasPayload: Boolean(baseRead.payload),
      matchedFromUniverse: false,
      missReason: baseRead.missReason,
    });
    if (availability === "temporarily_unavailable") {
      const missReason = (baseRead.missReason ?? "").trim();
      return {
        error: "base_temporarily_unavailable",
        failureClass: [
          baseRegistryProof.failureClass ?? (missReason === "read_timeout" ? "timeout" : "base_read_failed"),
        ],
      };
    }
    return { error: "base_not_found", failureClass: [] };
  }
  const failureClass: string[] = [];
  const degradedSources: string[] = baseFromRegistryFallback ? ["base_registry"] : [];
  const baseSnapshotMs = Date.parse(baseFund.latestSnapshotDate ?? "");
  const selectedReads = await Promise.all(
    compareCodes.map(async (code) => {
      try {
        return await withTimeout(
          readServingPayloadForCompareSeries(code, readServing),
          COMPARE_SERIES_SECONDARY_TIMEOUT_MS,
          "compare_series_secondary_read"
        );
      } catch (error) {
        degradedSources.push(`secondary:${code}`);
        failureClass.push(isTimeoutLike(error) ? "timeout" : "secondary_read_failed");
        return { payload: null };
      }
    })
  );
  const orderedSelected = selectedReads
    .map((read) => read.payload)
    .filter((payload): payload is FundDetailCoreServingPayload => payload != null)
    .filter((payload) => {
      if (!Number.isFinite(baseSnapshotMs)) return true;
      const refMs = Date.parse(payload.latestSnapshotDate ?? "");
      if (!Number.isFinite(refMs)) return false;
      const lagDays = Math.floor((baseSnapshotMs - refMs) / DAY_MS);
      const keep = lagDays <= MAX_REF_SNAPSHOT_LAG_DAYS;
      if (!keep) {
        console.info(
          `[compare-series-stale-guard] base=${baseFund.fund.code} ref=${payload.fund.code} base_snapshot=${baseFund.latestSnapshotDate ?? "none"} ` +
            `ref_snapshot=${payload.latestSnapshotDate ?? "none"} lag_days=${lagDays} decision=drop`
        );
      }
      return keep;
    });

  const anchor = startOfUtcDay(new Date());
  const shouldBuildCategoryReference = Boolean(baseFund.fund.categoryCode);
  const [macroResult, categoryReferenceResult] = await Promise.all([
    readOptionalMacroBuckets(anchor, fetchMacro),
    shouldBuildCategoryReference
      ? readOptionalCategoryReferencePayloads({ baseFund, getUniverse, readServing })
      : Promise.resolve(null),
  ]);
  const macroByRef = macroResult.macroByRef;
  if (macroResult.degraded) {
    degradedSources.push(macroResult.degraded.degradedSource);
    failureClass.push(macroResult.degraded.failureClass);
  }
  if (categoryReferenceResult?.degraded) {
    degradedSources.push(categoryReferenceResult.degraded.degradedSource);
    failureClass.push(categoryReferenceResult.degraded.failureClass);
  }

  const fundSeries = [
    {
      key: `fund:${baseFund.fund.code}`,
      label: `${baseFund.fund.code} (Fon)`,
      code: baseFund.fund.code,
      series: pointsFromServingPayload(baseFund),
    },
    ...orderedSelected.map((fund) => ({
      key: `fund:${fund.fund.code}`,
      label: `${fund.fund.code}`,
      code: fund.fund.code,
      series: pointsFromServingPayload(fund),
    })),
  ];
  console.info(
    `[compare-series-stale-guard] base=${baseFund.fund.code} base_snapshot=${baseFund.latestSnapshotDate ?? "none"} ` +
      `requested_refs=${compareCodes.length} accepted_refs=${Math.max(0, fundSeries.length - 1)} lag_threshold_days=${MAX_REF_SNAPSHOT_LAG_DAYS}`
  );

  const payload: CompareSeriesPayload = {
    fundSeries,
    macroSeries: {
      category:
        shouldBuildCategoryReference && categoryReferenceResult
          ? buildCategorySeriesFromServingPayloads(baseFund, categoryReferenceResult.records)
          : [],
      bist100: (macroByRef.bist100 ?? []).map((x) => ({ t: normalizeCompareHistoryDate(x.date).getTime(), v: x.value })),
      usdtry: (macroByRef.usdtry ?? []).map((x) => ({ t: normalizeCompareHistoryDate(x.date).getTime(), v: x.value })),
      eurtry: (macroByRef.eurtry ?? []).map((x) => ({ t: normalizeCompareHistoryDate(x.date).getTime(), v: x.value })),
      gold: (macroByRef.gold ?? []).map((x) => ({ t: normalizeCompareHistoryDate(x.date).getTime(), v: x.value })),
      policy: (macroByRef.policy ?? []).map((x) => ({ t: normalizeCompareHistoryDate(x.date).getTime(), v: x.value })),
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
  return {
    payload,
    degraded: degradedSources.length > 0 || failureClass.length > 0,
    degradedSources: [...new Set(degradedSources)],
    failureClass: [...new Set(failureClass)],
  } as CompareSeriesBuildResult;
}

export async function GET(req: NextRequest) {
  try {
    const baseCode = normalizeBaseCode(req.nextUrl.searchParams.get("base"));
    if (!baseCode) {
      return NextResponse.json({ error: "base_required" }, { status: 400 });
    }
    if (!ACTIVE_FUND_CODE_RE.test(baseCode)) {
      return NextResponse.json({ error: "base_not_found" }, { status: 404 });
    }
    const compareCodes = parseCompareCodes(req.nextUrl.searchParams.get("codes"), {
      maxCodes: MAX_CODES,
      codeRe: CODE_RE,
    }).filter((c) => c !== baseCode);

    // Compare payload'da özellikle geçmiş backfill sonrası stale sonuç istemiyoruz.
    // Versiyon yine okunur; yanıt HTTP cache başlıklarıyla CDN katmanında korunur.
    await withTimeout(readCompareDataVersion(), COMPARE_SERIES_VERSION_TIMEOUT_MS, "compare_series_version").catch(() => null);
    const result = await getCompareSeriesPayload(baseCode, compareCodes);

    if ("error" in result) {
      const status = result.error === "base_not_found" ? 404 : 503;
      return NextResponse.json(
        { error: result.error },
        {
          status,
          headers: result.failureClass.length
            ? { "X-Compare-Series-Failure-Class": result.failureClass.join(",") }
            : undefined,
        }
      );
    }

    return NextResponse.json(
      result.payload,
      {
        headers: {
          "Cache-Control": liveDataCacheControl(LIVE_DATA_CACHE_SEC, LIVE_DATA_SWR_SEC),
          ...(result.degraded ? { "X-Compare-Series-Degraded": "1" } : {}),
          ...(result.degradedSources.length
            ? { "X-Compare-Series-Degraded-Source": result.degradedSources.join(",") }
            : {}),
          ...(result.failureClass.length
            ? { "X-Compare-Series-Failure-Class": result.failureClass.join(",") }
            : {}),
        },
      }
    );
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[funds/compare-series]", error);
    }
    return NextResponse.json({ error: "compare_series_failed" }, { status: 500 });
  }
}

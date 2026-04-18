import { kiyasPolicyReturnPctForWindow } from "@/lib/kiyas-policy-return-window";
import type { FundKiyasViewPayload, KiyasPeriodId, KiyasPeriodRow, KiyasRefKey } from "@/lib/services/fund-detail-kiyas.service";

const DAY_MS = 86_400_000;
const ALIGN_NEAREST_TOLERANCE_MS = 5 * DAY_MS;

/**
 * Yüzde puanı cinsinden “başa baş” eşiği: |fon − referans| ≤ bu değer ise durum nötr.
 * UI ve `buildBenchmarkComparisonView` aynı sabiti kullanır.
 */
export const BENCHMARK_COMPARISON_TIE_EPS_PP = 0.15;

export type BenchmarkComparisonOutcome = "outperform" | "underperform" | "neutral" | "insufficient_data";

/** Kıyas satırı — tek kaynak; grafik penceresiyle aynı startT/endT üzerinden hesaplanır. */
export type BenchmarkComparisonRow = {
  key: KiyasRefKey;
  label: string;
  typeLabel: string;
  periodId: KiyasPeriodId;
  /** Seri uçları bu pencerede okunabildi mi */
  hasEnoughData: boolean;
  /** Pencere ankoru (ms); seri yolu için summary/liste/grafik aynı aralığı paylaşır */
  periodStartMs?: number;
  periodEndMs?: number;
  fundReturnPct: number | null;
  referenceReturnPct: number | null;
  comparisonDeltaPct: number | null;
  outcome: BenchmarkComparisonOutcome;
};

export type BenchmarkComparisonView = {
  rows: BenchmarkComparisonRow[];
  unavailableRefs: Array<{ key: KiyasRefKey; label: string; typeLabel: string }>;
  passedCount: number;
  behindCount: number;
  tiedCount: number;
  /** Veri eksik satırlar (yalnızca seri penceresi dışı / boş; rows içinde gösterilir) */
  insufficientDataCount: number;
  strongestRow: BenchmarkComparisonRow | null;
  strongestOutperformRow: BenchmarkComparisonRow | null;
  strongestUnderperformRow: BenchmarkComparisonRow | null;
  primaryRow: BenchmarkComparisonRow | null;
};

type ComparisonPoint = { t: number; v: number };

type RangeSlice = {
  sorted: ComparisonPoint[];
  sliced: ComparisonPoint[];
  startValue: number;
  endValue: number;
  returnPct: number;
  normalized: ComparisonPoint[];
};

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function comparisonRefType(key: KiyasRefKey): string {
  if (key === "category") return "Kategori";
  if (key === "bist100") return "Hisse";
  if (key === "usdtry" || key === "eurtry") return "Kur";
  if (key === "gold") return "Emtia";
  if (key === "policy") return "Faiz";
  return "Referans";
}

function fallbackComparisonLabel(key: KiyasRefKey): string {
  if (key === "category") return "Kategori Ortalaması";
  if (key === "bist100") return "BIST 100";
  if (key === "usdtry") return "USD/TRY";
  if (key === "eurtry") return "EUR/TRY";
  if (key === "gold") return "Altın";
  if (key === "policy") return "Politika Faizi";
  return "Referans";
}

export function benchmarkComparisonOutcomeFromDelta(delta: number): BenchmarkComparisonOutcome {
  if (delta > BENCHMARK_COMPARISON_TIE_EPS_PP) return "outperform";
  if (delta < -BENCHMARK_COMPARISON_TIE_EPS_PP) return "underperform";
  return "neutral";
}

function normalizeRow(key: KiyasRefKey, row: KiyasPeriodRow, label: string): BenchmarkComparisonRow | null {
  if (!finite(row.fundPct) || !finite(row.refPct)) return null;
  const comparisonDeltaPct = row.fundPct - row.refPct;
  return {
    key,
    label,
    typeLabel: comparisonRefType(key),
    periodId: row.periodId,
    hasEnoughData: true,
    fundReturnPct: row.fundPct,
    referenceReturnPct: row.refPct,
    comparisonDeltaPct,
    outcome: benchmarkComparisonOutcomeFromDelta(comparisonDeltaPct),
  };
}

function valueOnOrBeforeIndex(series: ComparisonPoint[], t: number): number {
  if (series.length === 0) return -1;
  let lo = 0;
  let hi = series.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const mt = series[mid]!.t;
    if (mt <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** valueOnOrBefore ikili arama için t artan; aynı t tekrarlarında son örnek kalır. */
function sortPointsAsc(points: ComparisonPoint[]): ComparisonPoint[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const out: ComparisonPoint[] = [];
  for (const p of sorted) {
    if (!finite(p.v)) continue;
    if (out.length > 0 && out[out.length - 1]!.t === p.t) {
      out[out.length - 1] = p;
    } else {
      out.push(p);
    }
  }
  return out;
}

function normalizeSeriesForRange(
  series: ComparisonPoint[],
  startT: number,
  endT: number,
  requireWindowProgress: boolean
): RangeSlice | null {
  if (!Number.isFinite(startT) || !Number.isFinite(endT) || endT <= startT) return null;
  const sorted = sortPointsAsc(series);
  if (sorted.length < 2) return null;

  const nearestIndex = (targetT: number): number => {
    const atOrBefore = valueOnOrBeforeIndex(sorted, targetT);
    const next = atOrBefore >= 0 && atOrBefore + 1 < sorted.length ? atOrBefore + 1 : atOrBefore;
    const candidates = [atOrBefore, next].filter((idx): idx is number => idx >= 0);
    if (candidates.length === 0) return -1;
    let best = candidates[0]!;
    let bestDelta = Math.abs(sorted[best]!.t - targetT);
    for (const idx of candidates.slice(1)) {
      const delta = Math.abs(sorted[idx]!.t - targetT);
      if (delta < bestDelta) {
        best = idx;
        bestDelta = delta;
      }
    }
    return bestDelta <= ALIGN_NEAREST_TOLERANCE_MS ? best : atOrBefore;
  };
  const startIndex = nearestIndex(startT);
  const endIndex = nearestIndex(endT);
  if (startIndex < 0 || endIndex < 0) return null;
  let effectiveStartIndex = startIndex;
  let effectiveEndIndex = endIndex;
  if (requireWindowProgress && effectiveStartIndex === effectiveEndIndex) {
    const collapsedPoint = sorted[effectiveStartIndex]!;
    if (collapsedPoint.t < startT) return null;
    if (effectiveStartIndex > 0) {
      effectiveStartIndex -= 1;
    } else if (effectiveEndIndex < sorted.length - 1) {
      effectiveEndIndex += 1;
    } else {
      return null;
    }
  }

  const startValue = sorted[effectiveStartIndex]!.v;
  const endValue = sorted[effectiveEndIndex]!.v;
  if (!finite(startValue) || !finite(endValue) || startValue <= 0) return null;

  const sliced = sorted.slice(effectiveStartIndex, effectiveEndIndex + 1);
  if (sliced.length < 2) return null;

  const returnPct = ((endValue / startValue) - 1) * 100;
  const normalized = sliced.map((point) => ({
    t: point.t,
    v: ((point.v / startValue) - 1) * 100,
  }));

  return {
    sorted,
    sliced,
    startValue,
    endValue,
    returnPct,
    normalized,
  };
}

function countAlignedDates(a: RangeSlice, b: RangeSlice): { aligned: number; droppedLeft: number; droppedRight: number } {
  const left = new Set(a.sliced.map((point) => point.t));
  let aligned = 0;
  for (const point of b.sliced) {
    if (left.has(point.t)) aligned += 1;
  }
  return {
    aligned,
    droppedLeft: Math.max(0, a.sliced.length - aligned),
    droppedRight: Math.max(0, b.sliced.length - aligned),
  };
}

function rowsSummary(rows: BenchmarkComparisonRow[]): {
  passedCount: number;
  behindCount: number;
  tiedCount: number;
  insufficientDataCount: number;
  strongestRow: BenchmarkComparisonRow | null;
  strongestOutperformRow: BenchmarkComparisonRow | null;
  strongestUnderperformRow: BenchmarkComparisonRow | null;
} {
  const eps = BENCHMARK_COMPARISON_TIE_EPS_PP;
  const ok = (row: BenchmarkComparisonRow) => row.hasEnoughData && row.comparisonDeltaPct != null && finite(row.comparisonDeltaPct);
  const passedCount = rows.filter((row) => ok(row) && (row.comparisonDeltaPct as number) > eps).length;
  const behindCount = rows.filter((row) => ok(row) && (row.comparisonDeltaPct as number) < -eps).length;
  const tiedCount = rows.filter((row) => ok(row) && Math.abs(row.comparisonDeltaPct as number) <= eps).length;
  const insufficientDataCount = rows.filter((row) => !row.hasEnoughData).length;
  const comparable = rows.filter(ok);
  const strongestRow =
    comparable.length > 0
      ? [...comparable].sort((a, b) => (b.comparisonDeltaPct as number) - (a.comparisonDeltaPct as number))[0] ?? null
      : null;
  const outperformRows = comparable.filter((row) => (row.comparisonDeltaPct as number) > eps);
  const underperformRows = comparable.filter((row) => (row.comparisonDeltaPct as number) < -eps);
  const strongestOutperformRow =
    outperformRows.length > 0
      ? [...outperformRows].sort((a, b) => (b.comparisonDeltaPct as number) - (a.comparisonDeltaPct as number))[0] ?? null
      : null;
  const strongestUnderperformRow =
    underperformRows.length > 0
      ? [...underperformRows].sort((a, b) => (a.comparisonDeltaPct as number) - (b.comparisonDeltaPct as number))[0] ?? null
      : null;

  return {
    passedCount,
    behindCount,
    tiedCount,
    insufficientDataCount,
    strongestRow,
    strongestOutperformRow,
    strongestUnderperformRow,
  };
}

function buildRowsFromSeriesWindow(input: {
  block: FundKiyasViewPayload | null;
  periodId: KiyasPeriodId;
  labels?: Partial<Record<string, string>>;
  preferredOrder: KiyasRefKey[];
  selectedRef: KiyasRefKey | null;
  seriesWindow: {
    fundSeries: ComparisonPoint[];
    refSeriesByKey: Partial<Record<KiyasRefKey, ComparisonPoint[]>>;
    startT: number;
    endT: number;
  };
}): BenchmarkComparisonView {
  const rows: BenchmarkComparisonRow[] = [];
  const unavailableRefs: Array<{ key: KiyasRefKey; label: string; typeLabel: string }> = [];
  let alignedDatesTotal = 0;
  let droppedFundDatesTotal = 0;
  let droppedRefDatesTotal = 0;
  const invalidationReasons = new Map<string, number>();
  const survivedRefs: string[] = [];
  const bumpInvalidation = (reason: string) => {
    invalidationReasons.set(reason, (invalidationReasons.get(reason) ?? 0) + 1);
  };

  const { fundSeries, refSeriesByKey, startT, endT } = input.seriesWindow;
  const fundRange = normalizeSeriesForRange(fundSeries, startT, endT, true);
  const fundR = fundRange?.returnPct ?? null;
  const fundOk = fundR != null && finite(fundR);

  for (const key of input.preferredOrder) {
    const label =
      input.block?.refs.find((item) => item.key === key)?.label ??
      input.labels?.[key] ??
      fallbackComparisonLabel(key);
    const refSeries = refSeriesByKey[key] ?? [];

    if (!fundOk) {
      unavailableRefs.push({ key, label, typeLabel: comparisonRefType(key) });
      bumpInvalidation("fund_window_unavailable");
      continue;
    }

    let referenceReturnPct: number | null = null;
    let invalidReason: string | null = null;
    if (key === "policy") {
      const sorted = sortPointsAsc(refSeries);
      if (sorted.length >= 2) {
        referenceReturnPct = kiyasPolicyReturnPctForWindow(sorted, startT, endT);
        if (!finite(referenceReturnPct)) {
          invalidReason = "policy_window_unavailable";
        }
      } else {
        invalidReason = "policy_series_too_short";
      }
    } else {
      const refRange = normalizeSeriesForRange(refSeries, startT, endT, true);
      if (!refRange) {
        invalidReason = key === "category" ? "category_window_unavailable" : "macro_window_unavailable";
      }
      if (fundRange && refRange) {
        const align = countAlignedDates(fundRange, refRange);
        alignedDatesTotal += align.aligned;
        droppedFundDatesTotal += align.droppedLeft;
        droppedRefDatesTotal += align.droppedRight;
      }
      referenceReturnPct = refRange?.returnPct ?? null;
    }

    const hasEnoughData = finite(referenceReturnPct);
    if (!hasEnoughData) {
      // Grafik penceresiyle makro serisi hizalanamadığında, sunucu kıyas tablosunda bu dönem için
      // geçerli satır varsa onu kullan (kategori ile sınırlı kalmadan — BIST/faiz vb. için de).
      const blockRowsForKey = input.block?.rowsByRef[key];
      const blockRow = Array.isArray(blockRowsForKey)
        ? blockRowsForKey.find((row) => row.periodId === input.periodId)
        : undefined;
      if (blockRow && finite(blockRow.fundPct) && finite(blockRow.refPct)) {
        const comparisonDeltaPct = (blockRow.fundPct as number) - (blockRow.refPct as number);
        rows.push({
          key,
          label,
          typeLabel: comparisonRefType(key),
          periodId: input.periodId,
          hasEnoughData: true,
          periodStartMs: startT,
          periodEndMs: endT,
          fundReturnPct: blockRow.fundPct,
          referenceReturnPct: blockRow.refPct,
          comparisonDeltaPct,
          outcome: benchmarkComparisonOutcomeFromDelta(comparisonDeltaPct),
        });
        continue;
      }
      bumpInvalidation(invalidReason ?? "reference_return_unavailable");
      rows.push({
        key,
        label,
        typeLabel: comparisonRefType(key),
        periodId: input.periodId,
        hasEnoughData: false,
        periodStartMs: startT,
        periodEndMs: endT,
        fundReturnPct: fundR,
        referenceReturnPct: null,
        comparisonDeltaPct: null,
        outcome: "insufficient_data",
      });
      continue;
    }

    const comparisonDeltaPct = fundR - (referenceReturnPct as number);
    survivedRefs.push(key);
    rows.push({
      key,
      label,
      typeLabel: comparisonRefType(key),
      periodId: input.periodId,
      hasEnoughData: true,
      periodStartMs: startT,
      periodEndMs: endT,
      fundReturnPct: fundR,
      referenceReturnPct: referenceReturnPct as number,
      comparisonDeltaPct,
      outcome: benchmarkComparisonOutcomeFromDelta(comparisonDeltaPct),
    });
  }

  const summary = rowsSummary(rows);
  const pickPrimary = (candidates: BenchmarkComparisonRow[]) => {
    for (const row of candidates) {
      if (!row.hasEnoughData) continue;
      return row;
    }
    return null;
  };
  const primaryRow =
    (input.selectedRef ? pickPrimary(rows.filter((row) => row.key === input.selectedRef)) : null) ??
    pickPrimary(rows) ??
    null;

  const view: BenchmarkComparisonView = {
    rows,
    unavailableRefs,
    passedCount: summary.passedCount,
    behindCount: summary.behindCount,
    tiedCount: summary.tiedCount,
    insufficientDataCount: summary.insufficientDataCount,
    strongestRow: summary.strongestRow,
    strongestOutperformRow: summary.strongestOutperformRow,
    strongestUnderperformRow: summary.strongestUnderperformRow,
    primaryRow,
  };
  if (process.env.NODE_ENV !== "production") {
    const validRefs = rows.filter((row) => row.hasEnoughData).length;
    const invalidationSummary = [...invalidationReasons.entries()]
      .map(([reason, count]) => `${reason}:${count}`)
      .join(",");
    console.info(
      `[fund-detail-comparison] mode=window period=${input.periodId} window=${new Date(startT).toISOString()}..${new Date(endT).toISOString()} ` +
        `valid_refs=${validRefs}/${rows.length} aligned_dates=${alignedDatesTotal} dropped_fund_dates=${droppedFundDatesTotal} ` +
        `dropped_ref_dates=${droppedRefDatesTotal} unavailable_refs=${unavailableRefs.length} ` +
        `nearest_tolerance_days=${Math.round(ALIGN_NEAREST_TOLERANCE_MS / DAY_MS)} ` +
        `survived_refs=${survivedRefs.join(",") || "none"} invalid_reasons=${invalidationSummary || "none"}`
    );
  }
  return view;
}

export function buildBenchmarkComparisonView(input: {
  block: FundKiyasViewPayload | null;
  periodId: KiyasPeriodId;
  selectedRef?: KiyasRefKey | null;
  labels?: Partial<Record<string, string>>;
  preferredOrder?: KiyasRefKey[];
  seriesWindow?: {
    fundSeries: ComparisonPoint[];
    refSeriesByKey: Partial<Record<KiyasRefKey, ComparisonPoint[]>>;
    startT: number;
    endT: number;
  } | null;
}): BenchmarkComparisonView {
  const {
    block,
    periodId,
    selectedRef = null,
    labels,
    preferredOrder = ["category", "bist100", "usdtry", "eurtry", "gold", "policy"],
    seriesWindow = null,
  } = input;

  if (!block && !seriesWindow) {
    return {
      rows: [],
      unavailableRefs: [],
      passedCount: 0,
      behindCount: 0,
      tiedCount: 0,
      insufficientDataCount: 0,
      strongestRow: null,
      strongestOutperformRow: null,
      strongestUnderperformRow: null,
      primaryRow: null,
    };
  }

  if (seriesWindow) {
    return buildRowsFromSeriesWindow({
      block,
      periodId,
      labels,
      preferredOrder,
      selectedRef,
      seriesWindow,
    });
  }

  const rows: BenchmarkComparisonRow[] = [];
  const unavailableRefs: Array<{ key: KiyasRefKey; label: string; typeLabel: string }> = [];

  if (block) {
    for (const key of preferredOrder) {
      const periodRows = block.rowsByRef[key];
      if (!periodRows?.length) continue;

      const row = periodRows.find((item) => item.periodId === periodId);
      const label =
        block.refs.find((item) => item.key === key)?.label ??
        labels?.[key] ??
        fallbackComparisonLabel(key);

      if (!row) {
        unavailableRefs.push({ key, label, typeLabel: comparisonRefType(key) });
        continue;
      }

      const normalized = normalizeRow(key, row, label);
      if (!normalized) {
        unavailableRefs.push({ key, label, typeLabel: comparisonRefType(key) });
        continue;
      }

      rows.push(normalized);
    }
  }

  const summary = rowsSummary(rows);
  const pickPrimary = (candidates: BenchmarkComparisonRow[]) => {
    for (const row of candidates) {
      if (!row.hasEnoughData) continue;
      return row;
    }
    return null;
  };
  const primaryRow =
    (selectedRef ? pickPrimary(rows.filter((row) => row.key === selectedRef)) : null) ??
    pickPrimary(rows) ??
    null;

  const view: BenchmarkComparisonView = {
    rows,
    unavailableRefs,
    passedCount: summary.passedCount,
    behindCount: summary.behindCount,
    tiedCount: summary.tiedCount,
    insufficientDataCount: summary.insufficientDataCount,
    strongestRow: summary.strongestRow,
    strongestOutperformRow: summary.strongestOutperformRow,
    strongestUnderperformRow: summary.strongestUnderperformRow,
    primaryRow,
  };
  if (process.env.NODE_ENV !== "production") {
    const validRefs = rows.filter((row) => row.hasEnoughData).length;
    console.info(
      `[fund-detail-comparison] mode=block period=${periodId} valid_refs=${validRefs}/${rows.length} unavailable_refs=${unavailableRefs.length}`
    );
  }
  return view;
}

/** Yalnızca geliştirme / konsol incelemesi için — üretim UI’da kullanılmaz. */
export function summarizeBenchmarkComparisonViewForDev(view: BenchmarkComparisonView): {
  rows: Array<{
    key: KiyasRefKey;
    label: string;
    hasEnoughData: boolean;
    periodStartMs?: number;
    periodEndMs?: number;
    fundReturnPct: number | null;
    referenceReturnPct: number | null;
    comparisonDeltaPct: number | null;
    outcome: BenchmarkComparisonOutcome;
  }>;
  unavailableRefs: BenchmarkComparisonView["unavailableRefs"];
  passedCount: number;
  behindCount: number;
  tiedCount: number;
  insufficientDataCount: number;
  comparableCount: number;
  strongestOutperformKey: KiyasRefKey | null;
  strongestUnderperformKey: KiyasRefKey | null;
  primaryKey: KiyasRefKey | null;
} {
  const comparableCount = view.passedCount + view.behindCount + view.tiedCount;
  return {
    rows: view.rows.map((r) => ({
      key: r.key,
      label: r.label,
      hasEnoughData: r.hasEnoughData,
      periodStartMs: r.periodStartMs,
      periodEndMs: r.periodEndMs,
      fundReturnPct: r.fundReturnPct,
      referenceReturnPct: r.referenceReturnPct,
      comparisonDeltaPct: r.comparisonDeltaPct,
      outcome: r.outcome,
    })),
    unavailableRefs: view.unavailableRefs,
    passedCount: view.passedCount,
    behindCount: view.behindCount,
    tiedCount: view.tiedCount,
    insufficientDataCount: view.insufficientDataCount,
    comparableCount,
    strongestOutperformKey: view.strongestOutperformRow?.key ?? null,
    strongestUnderperformKey: view.strongestUnderperformRow?.key ?? null,
    primaryKey: view.primaryRow?.key ?? null,
  };
}

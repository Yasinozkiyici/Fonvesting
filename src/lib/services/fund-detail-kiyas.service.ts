import { prisma } from "@/lib/prisma";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";
import type { PricePoint } from "@/lib/scoring";
import { fetchSupabaseRestJson, hasSupabaseRestConfig } from "@/lib/supabase-rest";
import { macroTotalReturnPctForWindow, sampleOnOrBefore } from "@/lib/kiyas-macro-window";

const DAY_MS = 86_400_000;
const MIN_CATEGORY_FUNDS = 5;
const LOOKBACK_DAYS = 1125;
const KIYAS_CHART_MAX_POINTS = 240;
const MAX_DAILY_MACRO_STALENESS_DAYS = 10;
const MAX_POLICY_STALENESS_DAYS = 180;
const SUPABASE_MACRO_PAGE_SIZE = 1000;
/** Supabase REST isteği opsiyonel kıyas bütçesini tüketebildiği için varsayılan DB yolunu kullan; REST yalnızca açıkça etkinleştirilsin. */
const KIYAS_SUPABASE_REST_ENABLED = process.env.FUND_DETAIL_KIYAS_SUPABASE_REST === "1";
const KIYAS_SUPABASE_TIMEOUT_MS = parseEnvInt("FUND_DETAIL_KIYAS_SUPABASE_TIMEOUT_MS", 1_400, 300, 3_500);
const KIYAS_MACRO_CACHE_TTL_MS = parseEnvInt("FUND_DETAIL_KIYAS_MACRO_CACHE_TTL_MS", 120_000, 5_000, 30 * 60_000);
const KIYAS_CATEGORY_CACHE_TTL_MS = parseEnvInt(
  "FUND_DETAIL_KIYAS_CATEGORY_CACHE_TTL_MS",
  45_000,
  3_000,
  10 * 60_000
);

function parseEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export type KiyasTelemetry = {
  queryCount: number;
  cacheHitCount: number;
  dedupedCount: number;
};

type KiyasRuntimeState = {
  macroCache: Map<string, { updatedAt: number; data: Partial<Record<KiyasRefKey, Array<{ date: Date; value: number }>>> }>;
  macroInFlight: Map<string, Promise<Partial<Record<KiyasRefKey, Array<{ date: Date; value: number }>>>>>;
  categoryCache: Map<string, { updatedAt: number; data: KiyasDerivedSlice | null }>;
  categoryInFlight: Map<string, Promise<KiyasDerivedSlice | null>>;
};

function bumpQuery(telemetry?: KiyasTelemetry, count = 1): void {
  if (!telemetry) return;
  telemetry.queryCount += count;
}

function bumpCacheHit(telemetry?: KiyasTelemetry): void {
  if (!telemetry) return;
  telemetry.cacheHitCount += 1;
}

function bumpDeduped(telemetry?: KiyasTelemetry): void {
  if (!telemetry) return;
  telemetry.dedupedCount += 1;
}

function getKiyasRuntimeState(): KiyasRuntimeState {
  const g = globalThis as typeof globalThis & { __fundDetailKiyasRuntimeState?: KiyasRuntimeState };
  if (!g.__fundDetailKiyasRuntimeState) {
    g.__fundDetailKiyasRuntimeState = {
      macroCache: new Map(),
      macroInFlight: new Map(),
      categoryCache: new Map(),
      categoryInFlight: new Map(),
    };
  }
  return g.__fundDetailKiyasRuntimeState;
}

/** Makro seri kodları zaman içinde farklı adlarla tutulabildiği için alias seti kullanılır. */
const MACRO_CODE_ALIASES: Record<KiyasRefKey, string[]> = {
  category: [],
  policy: ["TCMB_POLICY_RATE", "POLICY_RATE", "TCMB_POLICY", "POLICY"],
  bist100: ["BIST100", "BIST_100", "XU100", "XU100TRY"],
  gold: ["GOLD_TRY_GRAM", "GOLDTRY", "XAU_TRY_GRAM", "XAUTRY"],
  usdtry: ["USDTRY", "USD_TRY", "USDTRY_SPOT"],
  eurtry: ["EURTRY", "EUR_TRY", "EURTRY_SPOT"],
};

export type KiyasRefKey = "category" | "policy" | "bist100" | "gold" | "usdtry" | "eurtry";

export type KiyasPeriodId = "1m" | "3m" | "6m" | "1y" | "2y" | "3y";

export type KiyasBand = "above" | "near" | "below";

export type KiyasPeriodRow = {
  periodId: KiyasPeriodId;
  label: string;
  fundPct: number | null;
  /** Makro/endeks ve politika faizi için referans getiri %. */
  refPct: number | null;
  /** Geriye dönük uyumluluk için tutulur; artık politika faizi kıyasında kullanılmaz. */
  refPolicyDeltaPp: number | null;
  band: KiyasBand | null;
  diffPct: number | null;
};

export type KiyasRefOption = { key: KiyasRefKey; label: string };

/** Grafik üstü kıyas çizgisi için (ms); sunucudan bir kez gelir, chip değişiminde yeniden istek yok. */
export type KiyasChartPoint = { t: number; v: number };

export type FundKiyasViewPayload = {
  refs: KiyasRefOption[];
  defaultRef: KiyasRefKey;
  rowsByRef: Record<string, KiyasPeriodRow[]>;
  summaryByRef: Partial<Record<KiyasRefKey, string>>;
  /** Makro / politika faizi seviye serileri (kategori hariç). */
  chartMacroByRef: Partial<Record<KiyasRefKey, KiyasChartPoint[]>>;
  /** Kategori referansı için dönem ortalamaları (grafikte doğrusal kıyas). */
  categoryReturnSlice: KiyasDerivedSlice | null;
  /** Grafik altı tek cümle özet; kısa ve sakin ton. */
  chartSummaryByRef: Partial<Record<KiyasRefKey, string>>;
};

/** Kıyas satırı hesaplarında kullanılan türev getiri dilimi (makro/kategori ile aynı dönemler). */
export type KiyasDerivedSlice = {
  return30d: number | null;
  return90d: number | null;
  return180d: number | null;
  return1y: number | null;
  return2y: number | null;
  return3y: number | null;
};

const PERIODS: Array<{ id: KiyasPeriodId; label: string; days: number; eps: number }> = [
  { id: "1m", label: "1 Ay", days: 30, eps: 0.45 },
  { id: "3m", label: "3 Ay", days: 90, eps: 0.95 },
  { id: "6m", label: "6 Ay", days: 180, eps: 1.45 },
  { id: "1y", label: "1 Yıl", days: 365, eps: 2.25 },
  { id: "2y", label: "2 Yıl", days: 730, eps: 3.5 },
  { id: "3y", label: "3 Yıl", days: 1095, eps: 5.25 },
];

export const KIYAS_REF_LABELS: Record<KiyasRefKey, string> = {
  category: "Kategori",
  policy: "Faiz",
  bist100: "BIST 100",
  gold: "Altın",
  usdtry: "USD/TRY",
  eurtry: "EUR/TRY",
};

function normalizeMacroCode(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function inferMacroRefKeyFromPattern(normalized: string): KiyasRefKey | null {
  if (!normalized) return null;
  const has = (token: string) => normalized.includes(token);

  // Politika faizi serileri farklı ortamlarda TCMB/FAIZ/INTEREST benzeri adlar taşıyabiliyor.
  if (has("POLICY") || has("FAIZ") || has("INTEREST") || (has("TCMB") && has("RATE"))) return "policy";
  if (has("XU100") || (has("BIST") && has("100"))) return "bist100";
  if (has("XAU") || has("ALTIN") || has("GOLD")) return "gold";
  if (has("USD") && has("TRY")) return "usdtry";
  if (has("EUR") && has("TRY")) return "eurtry";
  return null;
}

function macroCodeToRefKey(code: string | null | undefined): KiyasRefKey | null {
  const normalized = normalizeMacroCode(code);
  if (!normalized) return null;
  for (const [ref, aliases] of Object.entries(MACRO_CODE_ALIASES) as Array<[KiyasRefKey, string[]]>) {
    if (ref === "category") continue;
    if (aliases.some((alias) => normalizeMacroCode(alias) === normalized)) return ref;
  }
  return inferMacroRefKeyFromPattern(normalized);
}

function finalizeMacroBucket(
  ref: KiyasRefKey,
  points: Array<{ date: Date; value: number }>
): Array<{ date: Date; value: number }> {
  const byDay = new Map<number, number>();
  for (const point of points) {
    const day = startOfUtcDay(point.date).getTime();
    if (!Number.isFinite(day) || !Number.isFinite(point.value)) continue;
    if (ref !== "policy" && point.value <= 0) continue;
    // Aynı gün birden fazla seri/obs gelirse son kayıt kazanır.
    byDay.set(day, point.value);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, value]) => ({ date: new Date(t), value }));
}

type SupabaseMacroSeriesRow = { id: string; code: string };
type SupabaseMacroObservationRow = { seriesId: string; date: string; value: number };
type SupabaseFundIdRow = { id: string };
type SupabaseDerivedMetricsSlice = {
  return30d: number | null;
  return90d: number | null;
  return180d: number | null;
  return1y: number | null;
  return2y: number | null;
};

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function downsampleSeries<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points;
  if (maxPoints <= 2) return [points[0]!, points[points.length - 1]!];

  const result: T[] = [points[0]!];
  const middleCount = maxPoints - 2;
  const lastIndex = points.length - 1;
  for (let index = 1; index <= middleCount; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (middleCount + 1));
    const point = points[sourceIndex];
    if (point && point !== result[result.length - 1]) {
      result.push(point);
    }
  }
  if (result[result.length - 1] !== points[lastIndex]) {
    result.push(points[lastIndex]!);
  }
  return result;
}

function addUtcDays(d: Date, days: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return startOfUtcDay(x);
}

function returnApproxCalendarDaysFromPoints(points: PricePoint[], days: number): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  const cutoff = last.date.getTime() - days * DAY_MS;
  let start: PricePoint | null = null;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i]!;
    if (p.date.getTime() <= cutoff) {
      start = p;
      break;
    }
  }
  if (!start) start = points[0]!;
  if (start.price <= 0 || last.price <= 0) return null;
  return (last.price / start.price - 1) * 100;
}

function bandFor(fund: number, ref: number, eps: number): KiyasBand {
  const d = fund - ref;
  if (d > eps) return "above";
  if (d < -eps) return "below";
  return "near";
}

function valueOnOrBefore(sorted: Array<{ date: Date; value: number }>, t: Date): number | null {
  if (sorted.length === 0) return null;
  let lo = 0;
  let hi = sorted.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const td = sorted[mid]!.date.getTime();
    if (td <= t.getTime()) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ans < 0) return null;
  const v = sorted[ans]!.value;
  return finite(v) ? v : null;
}

/** Takvim günü penceresinde makro seri toplam getirisi % (karşılaştırma / skor için). */
export function kiyasMacroTotalReturnPct(
  sorted: Array<{ date: Date; value: number }>,
  anchor: Date,
  days: number
): number | null {
  return macroTotalReturnPctForWindow(sorted, anchor, days, MAX_DAILY_MACRO_STALENESS_DAYS);
}

function macroPolicyDeltaPp(sorted: Array<{ date: Date; value: number }>, anchor: Date, days: number): number | null {
  const end = anchor;
  const startTarget = addUtcDays(anchor, -days);
  const endV = valueOnOrBefore(sorted, end);
  const startV = valueOnOrBefore(sorted, startTarget);
  if (endV == null || startV == null) return null;
  return endV - startV;
}

/**
 * Politika faizi yıllık nominal oran kabul edilip seçilen vadeye bileşik ölçeklenir.
 * Böylece 1y satırı yıllık faiz getirisini, daha kısa/uzun vadeler ise ölçeklenmiş eşleniğini verir.
 */
function policyScaledReturnPct(
  sorted: Array<{ date: Date; value: number }>,
  anchor: Date,
  days: number
): number | null {
  const annualRateSample = sampleOnOrBefore(sorted, anchor);
  if (!annualRateSample) return null;
  const staleCutoff = addUtcDays(anchor, -MAX_POLICY_STALENESS_DAYS);
  if (annualRateSample.date.getTime() < staleCutoff.getTime()) return null;
  if (annualRateSample.value <= -100) return null;
  const gross = 1 + annualRateSample.value / 100;
  if (!Number.isFinite(gross) || gross <= 0) return null;
  return (gross ** (days / 365) - 1) * 100;
}

/** Fon profiline göre referans sırası (öncelik). */
export function resolveKiyasReferenceOrder(
  categoryCode: string | null,
  fundTypeCode: number | null,
  fundName: string
): KiyasRefKey[] {
  const c = (categoryCode ?? "").toUpperCase().trim();
  const n = (fundName ?? "").toUpperCase();
  const bes = n.includes("BES") || n.includes("EMEKLİLİK") || n.includes("EMEKLILIK");
  void fundTypeCode;

  const appendMissing = (preferred: KiyasRefKey[]): KiyasRefKey[] => {
    const fullSet: KiyasRefKey[] = ["category", "bist100", "usdtry", "eurtry", "gold", "policy"];
    return [...new Set([...preferred, ...fullSet])];
  };

  if (bes) {
    return appendMissing(["category", "policy", "bist100", "usdtry", "eurtry"]);
  }
  if (c === "ALT") {
    return appendMissing(["gold", "usdtry", "eurtry", "category"]);
  }
  if (c === "DYF" || n.includes("DÖVİZ") || n.includes("DOVIZ") || n.includes("DOLAR") || n.includes("EURO")) {
    return appendMissing(["usdtry", "eurtry", "category"]);
  }
  if (c === "PPF" || c === "BRC" || c === "BYF" || c === "OKS" || c === "OKCF" || c === "GYIF") {
    return appendMissing(["category", "policy", "usdtry", "eurtry"]);
  }
  if (c === "HSF" || c === "HYF") {
    return appendMissing(["category", "bist100", "gold", "usdtry", "eurtry"]);
  }
  if (c === "KTL") {
    return appendMissing(["category", "bist100", "usdtry", "eurtry", "gold"]);
  }
  return appendMissing(["category", "bist100", "usdtry", "eurtry", "policy", "gold"]);
}

function fundReturnForPeriod(
  period: (typeof PERIODS)[number],
  derived: {
    return30d: number | null;
    return90d: number | null;
    return180d: number | null;
    return1y: number | null;
    return2y: number | null;
    return3y: number | null;
  } | null,
  pricePoints: PricePoint[]
): number | null {
  if (derived) {
    let derivedValue: number | null = null;
    switch (period.id) {
      case "1m":
        derivedValue = finite(derived.return30d) ? derived.return30d : null;
        break;
      case "3m":
        derivedValue = finite(derived.return90d) ? derived.return90d : null;
        break;
      case "6m":
        derivedValue = finite(derived.return180d) ? derived.return180d : null;
        break;
      case "1y":
        derivedValue = finite(derived.return1y) ? derived.return1y : null;
        break;
      case "2y":
        derivedValue = finite(derived.return2y) ? derived.return2y : null;
        break;
      case "3y":
        derivedValue = finite(derived.return3y) ? derived.return3y : null;
        break;
      default:
        derivedValue = null;
        break;
    }
    if (derivedValue != null) return derivedValue;
  }
  return returnApproxCalendarDaysFromPoints(pricePoints, period.days);
}

function pickSummaryRow(
  ref: KiyasRefKey,
  row1y: KiyasPeriodRow | undefined,
  row6m: KiyasPeriodRow | undefined
): KiyasPeriodRow | undefined {
  if (ref === "policy") {
    if (row1y?.refPct != null && row1y.fundPct != null) return row1y;
    if (row6m?.refPct != null && row6m.fundPct != null) return row6m;
    return row1y ?? row6m;
  }
  if (row1y?.band != null && row1y.fundPct != null) return row1y;
  if (row6m?.band != null && row6m.fundPct != null) return row6m;
  return row1y?.fundPct != null ? row1y : row6m;
}

function buildSummary(
  ref: KiyasRefKey,
  row1y: KiyasPeriodRow | undefined,
  row6m: KiyasPeriodRow | undefined
): string {
  const pick = pickSummaryRow(ref, row1y, row6m);
  if (!pick || pick.fundPct == null) {
    return "Seçilen referansa göre dönemsel okuma aşağıda; yatırım tavsiyesi değildir.";
  }
  const refName = KIYAS_REF_LABELS[ref];
  if (ref === "policy" && pick.refPct != null) {
    if (pick.band === "above") {
      return "Fon getirisi ölçeklenmiş politika faizi eşiğinin üstünde; bu bir öneri değildir.";
    }
    if (pick.band === "below") {
      return "Fon getirisi ölçeklenmiş politika faizi eşiğinin altında; bu bir öneri değildir.";
    }
    return "Fon getirisi ölçeklenmiş politika faizi ile yakın bantta; bu bir öneri değildir.";
  }
  if (pick.band === "above") {
    return `Son okumada ${refName} karşılaştırmasında üst bantta; mutlak üstünlük iddiası değildir.`;
  }
  if (pick.band === "below") {
    return `Son okumada ${refName} görünümüne göre daha geride; tavsiye değildir.`;
  }
  if (pick.band === "near") {
    return `${refName} ile yakın bantta; yatırım tavsiyesi değildir.`;
  }
  return `Seçilen referansa göre dönemsel konum tabloda; yatırım tavsiyesi değildir.`;
}

/** Grafik altı kısa cümle; uzun uyarı metinleri yerine tek bakışta okuma. */
export function buildChartShortSummary(
  ref: KiyasRefKey,
  row1y: KiyasPeriodRow | undefined,
  row6m: KiyasPeriodRow | undefined
): string {
  const pick = pickSummaryRow(ref, row1y, row6m);
  if (!pick || pick.fundPct == null) {
    return "Seçili referansla dilimleri aşağıda karşılaştırın.";
  }
  const nm = KIYAS_REF_LABELS[ref];
  if (ref === "policy") {
    if (pick.band === "above") return "Son okumada ölçeklenmiş faiz görünümünün üzerinde kaldı.";
    if (pick.band === "below") return "Ölçeklenmiş faiz görünümüne göre daha geride göründü.";
    if (pick.band === "near") return "Faiz tarafıyla yakın bantta ilerledi.";
  }
  if (pick.band === "above") return `${nm} görünümüne göre daha güçlü bir patika izledi.`;
  if (pick.band === "below") return `${nm} görünümüne göre daha zayıf, ancak daha dengeli görünebilir.`;
  if (pick.band === "near") return `${nm} ile yakın bantta kaldı.`;
  return "Seçili referansla dilimleri tabloda karşılaştırın.";
}

function categoryRefForPeriodFromAvgs(categoryAvgs: KiyasDerivedSlice | null, id: KiyasPeriodId): number | null {
  if (!categoryAvgs) return null;
  switch (id) {
    case "1m":
      return finite(categoryAvgs.return30d) ? categoryAvgs.return30d : null;
    case "3m":
      return finite(categoryAvgs.return90d) ? categoryAvgs.return90d : null;
    case "6m":
      return finite(categoryAvgs.return180d) ? categoryAvgs.return180d : null;
    case "1y":
      return finite(categoryAvgs.return1y) ? categoryAvgs.return1y : null;
    case "2y":
      return finite(categoryAvgs.return2y) ? categoryAvgs.return2y : null;
    case "3y":
      return finite(categoryAvgs.return3y) ? categoryAvgs.return3y : null;
    default:
      return null;
  }
}

/** Tek fon + tek referans için dönem satırları (makro/kategori önceden yüklenmiş). */
export function computeKiyasPeriodRowsForFundRef(
  ref: KiyasRefKey,
  anchor: Date,
  derived: KiyasDerivedSlice | null,
  pricePoints: PricePoint[],
  categoryAvgs: KiyasDerivedSlice | null,
  macroByRef: Partial<Record<KiyasRefKey, Array<{ date: Date; value: number }>>>
): KiyasPeriodRow[] {
  const a = startOfUtcDay(anchor);
  const rows: KiyasPeriodRow[] = [];
  for (const p of PERIODS) {
    const fundR = fundReturnForPeriod(p, derived, pricePoints);
    let refPct: number | null = null;
    let refPolicyDeltaPp: number | null = null;
    let band: KiyasBand | null = null;
    let diffPct: number | null = null;

    if (ref === "category") {
      refPct = categoryRefForPeriodFromAvgs(categoryAvgs, p.id);
      if (fundR != null && refPct != null) {
        band = bandFor(fundR, refPct, p.eps);
        diffPct = fundR - refPct;
      }
    } else if (ref === "policy") {
      const s = macroByRef.policy;
      if (s && s.length >= 2) {
        refPct = policyScaledReturnPct(s, a, p.days);
        refPolicyDeltaPp = macroPolicyDeltaPp(s, a, p.days);
      }
      if (fundR != null && refPct != null) {
        band = bandFor(fundR, refPct, p.eps);
        diffPct = fundR - refPct;
      }
    } else {
      const s = macroByRef[ref];
      if (s && s.length >= 2) {
        refPct = kiyasMacroTotalReturnPct(s, a, p.days);
      }
      if (fundR != null && refPct != null) {
        band = bandFor(fundR, refPct, p.eps);
        diffPct = fundR - refPct;
      }
    }

    if (fundR == null) continue;
    if (ref === "category" && refPct == null) continue;
    if (ref === "policy" && refPct == null) continue;
    if (ref !== "category" && ref !== "policy" && refPct == null) continue;

    rows.push({
      periodId: p.id,
      label: p.label,
      fundPct: fundR,
      refPct,
      refPolicyDeltaPp,
      band,
      diffPct,
    });
  }
  return rows;
}

export async function fetchKiyasMacroBuckets(
  anchor: Date,
  telemetry?: KiyasTelemetry
): Promise<Partial<Record<KiyasRefKey, Array<{ date: Date; value: number }>>>> {
  const a = startOfUtcDay(anchor);
  const state = getKiyasRuntimeState();
  const cacheKey = `${a.toISOString()}|rest:${KIYAS_SUPABASE_REST_ENABLED ? 1 : 0}`;
  const cached = state.macroCache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt <= KIYAS_MACRO_CACHE_TTL_MS) {
    bumpCacheHit(telemetry);
    return cached.data;
  }
  const inflight = state.macroInFlight.get(cacheKey);
  if (inflight) {
    bumpDeduped(telemetry);
    return inflight;
  }

  const loadPromise = (async (): Promise<Partial<Record<KiyasRefKey, Array<{ date: Date; value: number }>>>> => {
  const macroByRef: Partial<Record<KiyasRefKey, Array<{ date: Date; value: number }>>> = {};
  if (KIYAS_SUPABASE_REST_ENABLED && hasSupabaseRestConfig()) {
    try {
      const seriesRows = await fetchSupabaseRestJson<SupabaseMacroSeriesRow[]>(
        `MacroSeries?select=id,code&isActive=eq.true&limit=500`,
        { revalidate: 300, timeoutMs: KIYAS_SUPABASE_TIMEOUT_MS, retries: 0 }
      );
      const idToCode = new Map(
        seriesRows
          .map((row) => ({ id: row.id, refKey: macroCodeToRefKey(row.code) }))
          .filter((item): item is { id: string; refKey: KiyasRefKey } => item.refKey != null)
          .map((item) => [item.id, item.refKey] as const)
      );
      const seriesIds = [...idToCode.keys()];
      if (seriesIds.length === 0) {
        state.macroCache.set(cacheKey, { updatedAt: Date.now(), data: macroByRef });
        return macroByRef;
      }

      const from = addUtcDays(a, -LOOKBACK_DAYS).toISOString();
      const until = a.toISOString();
      const obs: SupabaseMacroObservationRow[] = [];
      let offset = 0;
      while (true) {
        const page = await fetchSupabaseRestJson<SupabaseMacroObservationRow[]>(
          `MacroObservation?select=seriesId,date,value&seriesId=in.(${seriesIds.join(",")})&date=gte.${from}&date=lte.${until}&order=date.asc&limit=${SUPABASE_MACRO_PAGE_SIZE}&offset=${offset}`,
          { revalidate: 300, timeoutMs: KIYAS_SUPABASE_TIMEOUT_MS, retries: 0 }
        );
        obs.push(...page);
        if (page.length < SUPABASE_MACRO_PAGE_SIZE) break;
        offset += page.length;
        if (offset > 250_000) break;
      }
      const buckets = new Map<string, Array<{ date: Date; value: number }>>();
      for (const o of obs) {
        const key = idToCode.get(o.seriesId);
        if (!key) continue;
        const arr = buckets.get(key) ?? [];
        arr.push({ date: startOfUtcDay(new Date(o.date)), value: o.value });
        buckets.set(key, arr);
      }
      for (const [k, v] of buckets) {
        macroByRef[k as KiyasRefKey] = finalizeMacroBucket(k as KiyasRefKey, v);
      }
      state.macroCache.set(cacheKey, { updatedAt: Date.now(), data: macroByRef });
      return macroByRef;
    } catch (error) {
      console.error("[fund-detail-kiyas] supabase-rest macro fetch failed", error);
    }
  }

  bumpQuery(telemetry);
  const seriesRows = await prisma.macroSeries.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
  });
  const idToCode = new Map(
    seriesRows
      .map((row) => ({ id: row.id, refKey: macroCodeToRefKey(row.code) }))
      .filter((item): item is { id: string; refKey: KiyasRefKey } => item.refKey != null)
      .map((item) => [item.id, item.refKey] as const)
  );
  const seriesIds = [...idToCode.keys()];

  if (seriesIds.length === 0) {
    state.macroCache.set(cacheKey, { updatedAt: Date.now(), data: macroByRef });
    return macroByRef;
  }

  const from = addUtcDays(a, -LOOKBACK_DAYS);
  bumpQuery(telemetry);
  const obs = await prisma.macroObservation.findMany({
    where: { seriesId: { in: seriesIds }, date: { lte: a, gte: from } },
    orderBy: { date: "asc" },
    select: { seriesId: true, date: true, value: true },
  });
  const buckets = new Map<string, Array<{ date: Date; value: number }>>();
  for (const o of obs) {
    const key = idToCode.get(o.seriesId);
    if (!key) continue;
    const arr = buckets.get(key) ?? [];
    arr.push({ date: startOfUtcDay(o.date), value: o.value });
    buckets.set(key, arr);
  }
  for (const [k, v] of buckets) {
    macroByRef[k as KiyasRefKey] = finalizeMacroBucket(k as KiyasRefKey, v);
  }
  state.macroCache.set(cacheKey, { updatedAt: Date.now(), data: macroByRef });
  return macroByRef;
  })();

  state.macroInFlight.set(cacheKey, loadPromise);
  try {
    return await loadPromise;
  } finally {
    state.macroInFlight.delete(cacheKey);
  }
}

export async function fetchKiyasCategoryAvgsExcludingFund(
  categoryId: string | null,
  excludeFundId: string,
  telemetry?: KiyasTelemetry
): Promise<KiyasDerivedSlice | null> {
  if (!categoryId) return null;
  const state = getKiyasRuntimeState();
  const cacheKey = `${categoryId}|${excludeFundId}|rest:${KIYAS_SUPABASE_REST_ENABLED ? 1 : 0}`;
  const cached = state.categoryCache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt <= KIYAS_CATEGORY_CACHE_TTL_MS) {
    bumpCacheHit(telemetry);
    return cached.data;
  }
  const inflight = state.categoryInFlight.get(cacheKey);
  if (inflight) {
    bumpDeduped(telemetry);
    return inflight;
  }

  const loadPromise = (async (): Promise<KiyasDerivedSlice | null> => {
  if (KIYAS_SUPABASE_REST_ENABLED && hasSupabaseRestConfig()) {
    try {
      const fundRows = await fetchSupabaseRestJson<SupabaseFundIdRow[]>(
        `Fund?select=id&categoryId=eq.${categoryId}&isActive=eq.true&id=neq.${excludeFundId}&limit=500`,
        { revalidate: 300, timeoutMs: KIYAS_SUPABASE_TIMEOUT_MS, retries: 0 }
      );
      const fundIds = fundRows.map((row) => row.id);
      if (fundIds.length < MIN_CATEGORY_FUNDS) {
        state.categoryCache.set(cacheKey, { updatedAt: Date.now(), data: null });
        return null;
      }

      const metricsRows = await fetchSupabaseRestJson<SupabaseDerivedMetricsSlice[]>(
        `FundDerivedMetrics?select=return30d,return90d,return180d,return1y,return2y&fundId=in.(${fundIds.join(",")})&limit=500`,
        { revalidate: 300, timeoutMs: KIYAS_SUPABASE_TIMEOUT_MS, retries: 0 }
      );
      if (metricsRows.length < MIN_CATEGORY_FUNDS) {
        state.categoryCache.set(cacheKey, { updatedAt: Date.now(), data: null });
        return null;
      }

      const avg = (values: Array<number | null | undefined>): number | null => {
        const items = values.filter((value): value is number => finite(value));
        if (items.length < MIN_CATEGORY_FUNDS) return null;
        return items.reduce((sum, value) => sum + value, 0) / items.length;
      };

      const result: KiyasDerivedSlice = {
        return30d: avg(metricsRows.map((row) => row.return30d)),
        return90d: avg(metricsRows.map((row) => row.return90d)),
        return180d: avg(metricsRows.map((row) => row.return180d)),
        return1y: avg(metricsRows.map((row) => row.return1y)),
        return2y: avg(metricsRows.map((row) => row.return2y)),
        return3y: null,
      };
      state.categoryCache.set(cacheKey, { updatedAt: Date.now(), data: result });
      return result;
    } catch (error) {
      console.error("[fund-detail-kiyas] supabase-rest category averages failed", error);
    }
  }

  const whereCat = { fund: { categoryId, isActive: true, id: { not: excludeFundId } } };
  bumpQuery(telemetry);
  const agg = await prisma.fundDerivedMetrics.aggregate({
    where: whereCat,
    _avg: {
      return30d: true,
      return90d: true,
      return180d: true,
      return1y: true,
      return2y: true,
      // 3Y category ortalaması şu aşamada ham geçmişten türetilmiyor.
    },
    _count: {
      _all: true,
    },
  });
  const total = agg._count._all;
  if (total < MIN_CATEGORY_FUNDS) {
    state.categoryCache.set(cacheKey, { updatedAt: Date.now(), data: null });
    return null;
  }
  const result: KiyasDerivedSlice = {
    return30d: agg._avg.return30d,
    return90d: agg._avg.return90d,
    return180d: agg._avg.return180d,
    return1y: agg._avg.return1y,
    return2y: agg._avg.return2y,
    return3y: null,
  };
  state.categoryCache.set(cacheKey, { updatedAt: Date.now(), data: result });
  return result;
  })();

  state.categoryInFlight.set(cacheKey, loadPromise);
  try {
    return await loadPromise;
  } finally {
    state.categoryInFlight.delete(cacheKey);
  }
}

export async function buildFundKiyasBlock(input: {
  fundId: string;
  categoryId: string | null;
  categoryCode: string | null;
  fundName: string;
  fundTypeCode: number | null;
  anchorDate: Date;
  derived: {
    return30d: number | null;
    return90d: number | null;
    return180d: number | null;
    return1y: number | null;
    return2y: number | null;
    return3y: number | null;
  } | null;
  pricePoints: PricePoint[];
}, options?: { telemetry?: KiyasTelemetry }): Promise<FundKiyasViewPayload | null> {
  const anchor = startOfUtcDay(input.anchorDate);
  const order = resolveKiyasReferenceOrder(input.categoryCode, input.fundTypeCode, input.fundName);
  const telemetry = options?.telemetry;

  const [macroResult, categoryResult] = await Promise.allSettled([
    fetchKiyasMacroBuckets(anchor, telemetry),
    fetchKiyasCategoryAvgsExcludingFund(input.categoryId, input.fundId, telemetry),
  ]);

  const macroByRef: Partial<Record<KiyasRefKey, Array<{ date: Date; value: number }>>> =
    macroResult.status === "fulfilled" ? macroResult.value : {};
  const categoryAvgs: KiyasDerivedSlice | null =
    categoryResult.status === "fulfilled" ? categoryResult.value : null;

  if (macroResult.status === "rejected") {
    console.error("[fund-detail-kiyas] macro buckets failed", macroResult.reason);
  }
  if (categoryResult.status === "rejected") {
    console.error("[fund-detail-kiyas] category averages failed", categoryResult.reason);
  }

  const rowsByRef: Record<string, KiyasPeriodRow[]> = {};
  const refs: KiyasRefOption[] = [];

  for (const ref of order) {
    if (ref === "category" && !categoryAvgs) continue;
    if (ref !== "category" && ref !== "policy") {
      const s = macroByRef[ref];
      if (!s || s.length < 2) continue;
    }
    if (ref === "policy") {
      const s = macroByRef.policy;
      if (!s || s.length < 2) continue;
    }
    const rows = computeKiyasPeriodRowsForFundRef(
      ref,
      anchor,
      input.derived,
      input.pricePoints,
      categoryAvgs,
      macroByRef
    );
    if (rows.length === 0) continue;
    rowsByRef[ref] = rows;
    refs.push({ key: ref, label: KIYAS_REF_LABELS[ref] });
  }

  if (refs.length === 0) return null;

  const defaultRef = refs[0]!.key;
  const summaryByRef: Partial<Record<KiyasRefKey, string>> = {};
  const chartSummaryByRef: Partial<Record<KiyasRefKey, string>> = {};
  for (const r of refs) {
    const list = rowsByRef[r.key] ?? [];
    const row1y = list.find((x) => x.periodId === "1y");
    const row6m = list.find((x) => x.periodId === "6m");
    summaryByRef[r.key] = buildSummary(r.key, row1y, row6m);
    chartSummaryByRef[r.key] = buildChartShortSummary(r.key, row1y, row6m);
  }

  const chartMacroByRef: Partial<Record<KiyasRefKey, KiyasChartPoint[]>> = {};
  for (const key of ["bist100", "gold", "usdtry", "eurtry", "policy"] as const) {
    const arr = macroByRef[key];
    if (!arr?.length) continue;
    chartMacroByRef[key] = downsampleSeries(arr, KIYAS_CHART_MAX_POINTS).map((x) => ({ t: x.date.getTime(), v: x.value }));
  }

  return {
    refs,
    defaultRef,
    rowsByRef,
    summaryByRef,
    chartMacroByRef,
    categoryReturnSlice: categoryAvgs,
    chartSummaryByRef,
  };
}

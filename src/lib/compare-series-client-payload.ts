/**
 * İstemci tarafında `/api/funds/compare-series` gövdesini daraltır.
 * Sunucu `meta` alanı ekleyebilir; yalnızca grafik/kıyas için gerekli alanlar taşınır.
 */

export type CompareSeriesClientPayload = {
  fundSeries: Array<{ key: string; label: string; code: string; series: Array<{ t: number; v: number }> }>;
  macroSeries: {
    category: Array<{ t: number; v: number }>;
    bist100: Array<{ t: number; v: number }>;
    usdtry: Array<{ t: number; v: number }>;
    eurtry: Array<{ t: number; v: number }>;
    gold: Array<{ t: number; v: number }>;
    policy: Array<{ t: number; v: number }>;
  };
  labels: Partial<Record<string, string>>;
};

function isPoint(x: unknown): x is { t: number; v: number } {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.t === "number" && Number.isFinite(o.t) && typeof o.v === "number" && Number.isFinite(o.v);
}

function isPointSeries(x: unknown): x is Array<{ t: number; v: number }> {
  return Array.isArray(x) && x.every(isPoint);
}

function isFundSeriesEntry(x: unknown): x is CompareSeriesClientPayload["fundSeries"][number] {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.key === "string" &&
    typeof o.label === "string" &&
    typeof o.code === "string" &&
    isPointSeries(o.series)
  );
}

/**
 * API yanıtından istemci state'ine güvenli dönüşüm. Hatalı veya eksik gövde için `null`.
 */
export function normalizeCompareSeriesResponseBody(body: unknown): CompareSeriesClientPayload | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if ("error" in o && typeof o.error === "string") return null;
  if (!Array.isArray(o.fundSeries) || !o.fundSeries.every(isFundSeriesEntry)) return null;
  const macro = o.macroSeries;
  if (!macro || typeof macro !== "object") return null;
  const m = macro as Record<string, unknown>;
  const keys = ["category", "bist100", "usdtry", "eurtry", "gold", "policy"] as const;
  for (const k of keys) {
    if (!isPointSeries(m[k])) return null;
  }
  const labelsRaw = o.labels;
  const labels: Partial<Record<string, string>> = {};
  if (labelsRaw && typeof labelsRaw === "object") {
    for (const [key, val] of Object.entries(labelsRaw as Record<string, unknown>)) {
      if (typeof val === "string" && val.trim()) labels[key] = val;
    }
  }
  return {
    fundSeries: o.fundSeries,
    macroSeries: {
      category: m.category as Array<{ t: number; v: number }>,
      bist100: m.bist100 as Array<{ t: number; v: number }>,
      usdtry: m.usdtry as Array<{ t: number; v: number }>,
      eurtry: m.eurtry as Array<{ t: number; v: number }>,
      gold: m.gold as Array<{ t: number; v: number }>,
      policy: m.policy as Array<{ t: number; v: number }>,
    },
    labels,
  };
}

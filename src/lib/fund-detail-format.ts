/** Fon detay sayfası için tutarlı sayı/yüzde sunumu (liste/anasayfa davranışını değiştirmez). */

const LOCALE = "tr-TR" as const;

export function formatDetailNavPrice(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "—";
  const a = Math.abs(v);
  let minFd = 2;
  let maxFd = 2;
  if (a < 1) {
    minFd = 2;
    maxFd = 4;
  } else if (a < 10) {
    minFd = 2;
    maxFd = 4;
  } else if (a < 100) {
    minFd = 2;
    maxFd = 3;
  } else if (a < 1000) {
    minFd = 2;
    maxFd = 2;
  } else {
    minFd = 2;
    maxFd = 2;
  }
  return v.toLocaleString(LOCALE, { minimumFractionDigits: minFd, maximumFractionDigits: maxFd });
}

/** Grafik / eksen için birim fiyat etiketi (₺ öneki çağıran tarafta). */
export function formatChartAxisPriceTick(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "—";
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString(LOCALE, { maximumFractionDigits: 0 });
  if (a >= 100) return v.toLocaleString(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  if (a >= 10) return v.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  if (a >= 1) return v.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

/** Normalize edilmiş getiri ekseni (%) — okunaklı, aşırı küsurat yok. */
export function formatChartAxisPercentTick(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 100) return `${v.toLocaleString(LOCALE, { maximumFractionDigits: 0 })}%`;
  if (a >= 10) return `${v.toLocaleString(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
  if (a >= 1) return `${v.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  return `${v.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
}

/** Günlük / kısa getiri rozetleri (+/−, 2 ondalık). */
export function formatDetailSignedPercent(value: number, opts?: { invalidAsDash?: boolean; maxAbs?: number }): string {
  const maxAbs = opts?.maxAbs ?? 100;
  const v = Number(value);
  if (!Number.isFinite(v) || Math.abs(v) > maxAbs) return opts?.invalidAsDash === false ? "0,00%" : "—";
  if (v === 0) return "0,00%";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/** Seçili dönem ana yüzdesi — büyük punto; çok küçük değerlerde anlamlı gösterim. */
export function formatDetailPeriodReturnPercent(value: number): string {
  const v = Number(value);
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0,00%";
  const a = Math.abs(v);
  const digits = a < 0.1 ? 2 : a < 1 ? 2 : 2;
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/**
 * Net fark (fon − referans), pp cinsinden; `nearEpsilon` içinde işaretsiz küçük değer nötr.
 */
export function formatDetailDeltaPercent(
  value: number | null | undefined,
  nearEpsilon = 0
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs <= nearEpsilon && nearEpsilon > 0) {
    return `0,00%`;
  }
  const sign = value > nearEpsilon ? "+" : value < -nearEpsilon ? "-" : "";
  const body = Math.abs(value).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${body}%`;
}

/** Araç ipucu: tek başına yüzde (fon veya referans getirisi). */
export function formatDetailAbsolutePercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/** Risk kartları: oynaklık / drawdown / yaklaşık getiri. */
export function formatDetailRiskPercent(value: number, fractionDigits: 1 | 2): string {
  const v = Number(value);
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a > 0 && a < 0.005) return "≈0%";
  return `${v.toLocaleString(LOCALE, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}%`;
}

/** Aşırı büyük / bozuk baseline yüzde değişimlerini ekrana basmaz (raw sayılardan hesaplanır). */
const TREND_DELTA_PCT_ABS_CAP = 120_000;

/**
 * Trend penceresi yüzde değişimi — `start` ham seri değeri; yuvarlatılmış metin üzerinden hesaplanmaz.
 * `kind: "count"` için başlangıç < 1 güvenilmez kabul edilir (0 yatırımcı baseline).
 */
export function formatDetailTrendWindowDeltaPercent(
  start: number,
  end: number,
  kind?: "count" | "currency"
): string | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) return null;
  if (kind === "count" && start < 1) return null;
  const pct = (end / start - 1) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) > TREND_DELTA_PCT_ABS_CAP) return null;
  const a = Math.abs(pct);
  const maxFd = a < 0.05 ? 3 : a < 1 ? 2 : 1;
  const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
  return `${sign}${Math.abs(pct).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: maxFd })}%`;
}

export type TrendCardMetricKind = "count" | "currency";

/**
 * Trend kartı içi: görünür pencerenin göreli genişliğine göre hassasiyet artar (kompakt Mn tek haneye sıkışmaz).
 * `windowMin` / `windowMax` seçili penceredeki ham uç değerler olmalı.
 */
export function formatTrendCardNumeric(
  value: number,
  kind: TrendCardMetricKind,
  windowMin: number,
  windowMax: number
): string {
  if (!Number.isFinite(value)) return "—";
  const vmin = Number.isFinite(windowMin) ? windowMin : value;
  const vmax = Number.isFinite(windowMax) ? windowMax : value;
  const span = Math.abs(vmax - vmin);
  const scale = Math.max(Math.abs(vmax), Math.abs(vmin), Math.abs(value), 1e-12);
  const relativeSpan = span / scale;

  if (kind === "count") {
    const v = Math.round(value);
    if (!Number.isFinite(v)) return "—";
    if (relativeSpan < 0.055) {
      return v.toLocaleString(LOCALE, { maximumFractionDigits: 0 });
    }
    if (relativeSpan < 0.2) {
      if (v >= 1_000_000) {
        return `${(v / 1_000_000).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 3 })} Mn`;
      }
      if (v >= 10_000) {
        return `${(v / 1_000).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} B`;
      }
      return v.toLocaleString(LOCALE, { maximumFractionDigits: 0 });
    }
    if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mn`;
    if (v >= 1_000) return `${(v / 1_000).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} B`;
    return v.toLocaleString(LOCALE, { maximumFractionDigits: 0 });
  }

  /* currency — portföy büyüklüğü (TRY) */
  if (value <= 0) return "—";
  if (relativeSpan < 0.045) {
    return `${value.toLocaleString(LOCALE, { maximumFractionDigits: 0 })} ₺`;
  }
  if (relativeSpan < 0.16) {
    if (value >= 1_000_000) {
      return `${value.toLocaleString(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₺`;
    }
    return `${value.toLocaleString(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 1 })} ₺`;
  }
  if (value >= 1_000_000_000) return `₺${(value / 1_000_000_000).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} Mr`;
  if (value >= 1_000_000) return `₺${(value / 1_000_000).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} Mn`;
  if (value >= 1_000) return `₺${(value / 1_000).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} B`;
  return `₺${value.toLocaleString(LOCALE, { maximumFractionDigits: 0 })}`;
}

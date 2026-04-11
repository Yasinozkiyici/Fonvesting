/**
 * Günlük getiri (yüzde puanı, örn. 1,25 = %1,25) — tablo, özet ve yön sayıları için tek kaynak.
 * UI’da 2 ondalık ile "0,00%" görünen değerler nötr sayılır; ham 0 veya çok küçük farklar aynı dilimde birleşir.
 */

export type DailyReturnSign = "positive" | "negative" | "neutral";

/** Ham değeri tablo ile aynı 2 ondalığa yuvarlar (yarıya yuvarlama). */
export function roundDailyReturnPctPoints2dp(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  const r = Math.round(value * 100) / 100;
  return r === 0 ? 0 : r;
}

/** Yuvarlanmış değere göre yön; `v === 0` yerine yuvarlama ile uyumlu. */
export function classifyDailyReturnPctPoints2dp(value: number): DailyReturnSign {
  const r = roundDailyReturnPctPoints2dp(value);
  if (!Number.isFinite(r) || Math.abs(r) > 100) return "neutral";
  if (r > 0) return "positive";
  if (r < 0) return "negative";
  return "neutral";
}

export type DailyReturnFormatted = {
  /** Türkçe virgül, nötr için "0,00%" (asla "-0,00%"). */
  text: string;
  sign: DailyReturnSign;
};

/** Tablo / kart ile aynı metin ve sınıf. */
export function formatDailyReturnPctPointsTr(value: number): DailyReturnFormatted {
  if (!Number.isFinite(value) || Math.abs(value) > 100) {
    return { text: "—", sign: "neutral" };
  }
  const r = roundDailyReturnPctPoints2dp(value);
  if (r === 0) {
    return { text: "0,00%", sign: "neutral" };
  }
  const signChar = r > 0 ? "+" : "";
  return {
    text: `${signChar}${r.toFixed(2).replace(".", ",")}%`,
    sign: r > 0 ? "positive" : "negative",
  };
}

export function countDailyReturnDirections(values: Iterable<number>): {
  advancers: number;
  decliners: number;
  unchanged: number;
  total: number;
} {
  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;
  let total = 0;
  for (const v of values) {
    total += 1;
    switch (classifyDailyReturnPctPoints2dp(v)) {
      case "positive":
        advancers += 1;
        break;
      case "negative":
        decliners += 1;
        break;
      default:
        unchanged += 1;
    }
  }
  return { advancers, decliners, unchanged, total };
}

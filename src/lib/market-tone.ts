/**
 * Piyasa genişliği + ortalama günlük getiri ile editoryal "günün görünümü" etiketi.
 * MarketHeader ve keşif modülü aynı türevi kullanır (tek kaynak, mevcut snapshot verisi).
 */
export type MarketDayTone = { label: string; tone: "up" | "down" | "flat" };

export function deriveMarketTone(advancers: number, decliners: number, avgDailyReturn: number): MarketDayTone {
  const spread = advancers - decliners;
  const total = Math.max(advancers + decliners, 1);
  const strongThreshold = Math.max(36, Math.round(total * 0.1));
  if (spread >= strongThreshold && avgDailyReturn >= 0) return { label: "Olumlu görünüm", tone: "up" };
  if (spread <= -strongThreshold && avgDailyReturn <= 0) return { label: "Zayıf görünüm", tone: "down" };
  if (Math.abs(avgDailyReturn) <= 0.08) return { label: "Karışık görünüm", tone: "flat" };
  return { label: "Dengeli görünüm", tone: "flat" };
}

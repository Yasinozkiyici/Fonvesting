/**
 * Fon detay — “Alternatifler” listesi: aynı kategoride küçük bir seçki (3–5 satır).
 * Ağır öneri motoru hissi vermemek için kurallar sade ve etiketler kısadır.
 */

export const FUND_ALTERNATIVES_CANDIDATE_POOL = 24;
export const FUND_ALTERNATIVES_MAX = 4;

export type FundAlternativeSubject = {
  portfolioSize: number;
  investorCount: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
};

export type FundAlternativeCandidate = {
  code: string;
  name: string;
  shortName: string | null;
  lastPrice: number;
  dailyReturn: number;
  logoUrl: string | null;
  portfolioSize: number;
  investorCount: number;
  monthlyReturn: number;
  yearlyReturn: number;
};

export type BuiltAlternativeFund = {
  code: string;
  name: string;
  shortName: string | null;
  lastPrice: number;
  dailyReturn: number;
  yearlyReturn: number;
  logoUrl: string | null;
  reasonLabel: string;
};

function normCode(code: string): string {
  return code.trim().toUpperCase();
}

function scaleDistance(s: FundAlternativeSubject, p: FundAlternativeCandidate): number {
  if (s.portfolioSize > 0 && p.portfolioSize > 0) {
    const r = p.portfolioSize / s.portfolioSize;
    if (r > 0) return Math.abs(Math.log(r));
  }
  return Math.abs(p.investorCount - s.investorCount);
}

/** Ölçek + günlük/aylık/yıllık getiri yakınlığı (düşük = daha benzer). */
function profileDistance(s: FundAlternativeSubject, p: FundAlternativeCandidate): number {
  return (
    scaleDistance(s, p) * 1.15 +
    Math.abs(p.dailyReturn - s.dailyReturn) +
    Math.abs(p.monthlyReturn - s.monthlyReturn) * 0.22 +
    Math.abs(p.yearlyReturn - s.yearlyReturn) * 0.035
  );
}

/** Kısa vadede daha sakin okuma (mutlak günlük + aylık hareket; düşük = daha “dengeli”). */
function calmScore(p: FundAlternativeCandidate): number {
  return Math.abs(p.dailyReturn) + Math.abs(p.monthlyReturn) * 0.38;
}

function pickMin<T>(items: T[], score: (t: T) => number): T | undefined {
  if (items.length === 0) return undefined;
  let best = items[0]!;
  let bestS = score(best);
  for (let i = 1; i < items.length; i += 1) {
    const it = items[i]!;
    const sc = score(it);
    if (sc < bestS) {
      best = it;
      bestS = sc;
    }
  }
  return best;
}

function dedupeCandidates(raw: FundAlternativeCandidate[]): FundAlternativeCandidate[] {
  const m = new Map<string, FundAlternativeCandidate>();
  for (const c of raw) {
    if (!c.code?.trim()) continue;
    const k = normCode(c.code);
    if (!m.has(k)) m.set(k, c);
  }
  return [...m.values()];
}

function isLargerScale(s: FundAlternativeSubject, p: FundAlternativeCandidate): boolean {
  if (s.portfolioSize > 0 && p.portfolioSize > 0) {
    return p.portfolioSize > s.portfolioSize * 1.02;
  }
  return p.investorCount > s.investorCount;
}

/**
 * Sıra: (1) Benzer profil → (2) Daha büyük ölçek → (3) Daha dengeli → (4) Aynı kategori ile tamamlama.
 * En fazla `max` benzersiz kod.
 */
export function buildFundAlternatives(
  subject: FundAlternativeSubject,
  rawCandidates: FundAlternativeCandidate[],
  max: number = FUND_ALTERNATIVES_MAX
): BuiltAlternativeFund[] {
  const candidates = dedupeCandidates(rawCandidates);
  if (candidates.length === 0) return [];

  const picked = new Map<string, BuiltAlternativeFund>();

  const add = (c: FundAlternativeCandidate, reasonLabel: string) => {
    if (picked.size >= max) return;
    const k = normCode(c.code);
    if (picked.has(k)) return;
    picked.set(k, {
      code: c.code,
      name: c.name,
      shortName: c.shortName,
      lastPrice: c.lastPrice,
      dailyReturn: c.dailyReturn,
      yearlyReturn: c.yearlyReturn,
      logoUrl: c.logoUrl,
      reasonLabel,
    });
  };

  const unpicked = () => candidates.filter((c) => !picked.has(normCode(c.code)));

  const similar = pickMin(unpicked(), (p) => profileDistance(subject, p));
  if (similar) add(similar, "Benzer profil");

  const largerPool = unpicked().filter((p) => isLargerScale(subject, p));
  const larger = pickMin(largerPool, (p) => {
    if (subject.portfolioSize > 0 && p.portfolioSize > 0) {
      return p.portfolioSize;
    }
    return p.investorCount;
  });
  if (larger) add(larger, "Daha büyük ölçek");

  const calm = pickMin(unpicked(), (p) => calmScore(p));
  if (calm) add(calm, "Daha dengeli");

  const rest = unpicked().sort((a, b) => {
    const dp = b.portfolioSize - a.portfolioSize;
    if (dp !== 0) return dp;
    return b.investorCount - a.investorCount;
  });
  for (const c of rest) {
    add(c, "Aynı kategori");
    if (picked.size >= max) break;
  }

  return [...picked.values()];
}

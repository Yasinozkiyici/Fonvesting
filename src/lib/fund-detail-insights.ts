import type { FundDetailPageData } from "@/lib/services/fund-detail.service";
import type {
  FundKiyasViewPayload,
  KiyasBand,
  KiyasPeriodId,
  KiyasPeriodRow,
  KiyasRefKey,
} from "@/lib/services/fund-detail-kiyas.service";

const MAX_INSIGHTS = 3;

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Günlük getiri farkı için mutlak eşik (%). */
const PEER_DAILY_EPS = 0.12;

function insightPeerDaily(data: FundDetailPageData): string | null {
  const peers = data.similarCategoryPeerDailyReturns.filter((x) => Number.isFinite(x));
  if (peers.length < 3) return null;
  const mid = median(peers);
  if (mid == null) return null;
  const diff = data.fund.dailyReturn - mid;
  if (diff >= PEER_DAILY_EPS) {
    return "Bugünkü hareket, kategorideki tipik güne göre bir miktar daha güçlü.";
  }
  if (diff <= -PEER_DAILY_EPS) {
    return "Bugünkü hareket, kategorideki tipik güne göre daha zayıf kaldı.";
  }
  return null;
}

/** Aynı gün kesitinde mutlak günlük hareket; tipik alternatiflere göre dar bant. */
function insightPeerSteadiness(data: FundDetailPageData): string | null {
  const peers = data.similarCategoryPeerDailyReturns.filter((x) => Number.isFinite(x));
  if (peers.length < 5) return null;
  const f = Math.abs(data.fund.dailyReturn);
  const absPeers = peers.map(Math.abs);
  const mid = median(absPeers);
  if (mid == null || mid < 0.08) return null;
  if (f < mid * 0.62) {
    return "Yakın alternatiflere kıyasla günlük oynama daha sınırlı seyretti.";
  }
  return null;
}

function insightVolatility(data: FundDetailPageData): string | null {
  const m = data.historyMetrics ?? data.snapshotMetrics;
  if (!m || m.dataPoints < 40 || !Number.isFinite(m.volatility) || m.volatility <= 0) return null;
  if (m.volatility <= 12) {
    return "Tarihsel oynaklık görece sakin bir bantta.";
  }
  if (m.volatility >= 24) {
    return "Tarihsel oynaklık yüksek; kısa vadede dalga boyu artabilir.";
  }
  return null;
}

function insightDrawdown(data: FundDetailPageData): string | null {
  const m = data.historyMetrics ?? data.snapshotMetrics;
  if (!m || m.dataPoints < 40) return null;
  if (!Number.isFinite(m.maxDrawdown) || m.maxDrawdown <= 0 || m.maxDrawdown > 18) return null;
  return "Tarihsel zirve-dip geri çekilmesi sınırlı kalmış görünüyor.";
}

function insightRiskReturn(data: FundDetailPageData): string | null {
  const risk = data.riskLevel;
  if (risk !== "very_low" && risk !== "low") return null;
  const r1y = data.derivedSummary.returnApprox1YearPct;
  if (r1y == null || !Number.isFinite(r1y) || r1y <= 0 || r1y >= 60) return null;
  return "Düşük risk sınıfında, yaklaşık bir yılda pozitif bölgede.";
}

function insightOneYear(data: FundDetailPageData): string | null {
  const r1y = data.derivedSummary.returnApprox1YearPct;
  if (r1y == null || !Number.isFinite(r1y)) return null;
  const risk = data.riskLevel;
  const lowRisk = risk === "very_low" || risk === "low";
  if (r1y >= 4) {
    if (lowRisk && r1y < 60) return null;
    return "Yaklaşık bir yıllık görünüm pozitif bölgede.";
  }
  if (r1y <= -4) {
    return "Yaklaşık bir yıllık görünümde düşüş baskısı öne çıkıyor.";
  }
  return null;
}

function insightScale(data: FundDetailPageData): string | null {
  const { investorCount, portfolioSize } = data.fund;
  if (investorCount >= 20_000 && portfolioSize >= 3_000_000_000) {
    return "Geniş yatırımcı tabanı ve yüksek portföy büyüklüğüyle ölçekli bir fon.";
  }
  return null;
}

function periodPhrase(id: KiyasPeriodId): string {
  switch (id) {
    case "1y":
      return "Son bir yılda";
    case "6m":
      return "Son altı ayda";
    case "3m":
      return "Son üç ayda";
    case "1m":
      return "Son ayda";
    case "2y":
      return "Son iki yılda";
    case "3y":
      return "Son üç yılda";
    default:
      return "Seçili dilimde";
  }
}

function pickKiyasRowForInsight(ref: KiyasRefKey, rows: KiyasPeriodRow[]): KiyasPeriodRow {
  const byId = (id: KiyasPeriodId) => rows.find((r) => r.periodId === id);
  if (ref === "policy") {
    return byId("1y") ?? byId("6m") ?? rows[rows.length - 1]!;
  }
  const pref: KiyasPeriodId[] = ["1y", "3y", "2y", "6m", "3m", "1m"];
  for (const id of pref) {
    const r = byId(id);
    if (r && r.fundPct != null) return r;
  }
  return rows[rows.length - 1]!;
}

function kiyasLinePolicy(row: KiyasPeriodRow): string | null {
  const ref = row.refPct;
  const f = row.fundPct;
  const band = row.band;
  if (ref == null || f == null || band == null || !Number.isFinite(ref) || !Number.isFinite(f)) return null;
  const p = periodPhrase(row.periodId);
  if (band === "above") return `${p} ölçeklenmiş faiz eşiğinin üzerinde kaldı.`;
  if (band === "below") return `${p} ölçeklenmiş faiz eşiğinin altında kaldı.`;
  return `${p} ölçeklenmiş faiz eşiğine yakın seyretti.`;
}

function kiyasLineBand(ref: KiyasRefKey, row: KiyasPeriodRow, band: KiyasBand): string | null {
  const p = periodPhrase(row.periodId);
  if (ref === "category") {
    if (band === "above") return `${p} kategori ortalamasının üzerinde kaldı.`;
    if (band === "below") return `${p} kategori ortalamasının altında kaldı.`;
    if (band === "near") return `${p} kategori ortalamasına yakın seyretti.`;
    return null;
  }
  if (ref === "bist100") {
    if (band === "above") return `${p} BIST 100 karşılaştırmasında daha güçlü seyretti.`;
    if (band === "below") return `${p} BIST 100’e göre daha geride kaldı.`;
    if (band === "near") return `${p} BIST 100 ile yakın bantta ilerledi.`;
    return null;
  }
  if (ref === "gold") {
    if (band === "above") return `${p} altın karşılaştırmasında daha güçlü seyretti.`;
    if (band === "below") return `${p} altın hareketine göre daha zayıf seyretti.`;
    if (band === "near") return `${p} altın hareketine yakın kaldı.`;
    return null;
  }
  if (ref === "usdtry") {
    if (band === "above") return `${p} USD/TRY karşılaştırmasında daha önde kaldı.`;
    if (band === "below") return `${p} USD/TRY’ye göre daha geride kaldı.`;
    if (band === "near") return `${p} USD/TRY hareketi karşısında daha sakin bir getiri yolu izledi.`;
    return null;
  }
  if (ref === "eurtry") {
    if (band === "above") return `${p} EUR/TRY karşılaştırmasında daha önde kaldı.`;
    if (band === "below") return `${p} EUR/TRY’ye göre daha geride kaldı.`;
    if (band === "near") return `${p} EUR/TRY hareketi karşısında daha sakin bir getiri yolu izledi.`;
    return null;
  }
  return null;
}

/**
 * Kıyas bloğu ile aynı referans sırası (`refs`); en fazla iki kısa satır, üçüncüyü fon profiline bırakır.
 */
function buildKiyasStandoutLines(block: FundKiyasViewPayload): string[] {
  const strong: string[] = [];
  const soft: string[] = [];

  for (const opt of block.refs) {
    const rows = block.rowsByRef[opt.key];
    if (!rows?.length) continue;
    const row = pickKiyasRowForInsight(opt.key, rows);

    if (opt.key === "policy") {
      const line = kiyasLinePolicy(row);
      if (line) strong.push(line);
      continue;
    }

    if (row.band) {
      const line = kiyasLineBand(opt.key, row, row.band);
      if (!line) continue;
      if (row.band === "near") soft.push(line);
      else strong.push(line);
    }
  }

  const out: string[] = [];
  const pushUnique = (s: string) => {
    if (out.includes(s)) return;
    out.push(s);
  };
  for (const s of strong) {
    pushUnique(s);
    if (out.length >= 2) break;
  }
  if (out.length < 2) {
    for (const s of soft) {
      pushUnique(s);
      if (out.length >= 2) break;
    }
  }
  return out.slice(0, 2);
}

/** En fazla üç kısa satır; kıyas + profil karışımı, tavsiye değildir. */
export function buildFundWhyStandsOutInsights(data: FundDetailPageData): string[] {
  const out: string[] = [];
  const add = (s: string | null | undefined) => {
    if (!s || out.length >= MAX_INSIGHTS) return;
    if (!out.includes(s)) out.push(s);
  };

  const fromKiyas = data.kiyasBlock ? buildKiyasStandoutLines(data.kiyasBlock) : [];
  for (const s of fromKiyas) add(s);

  const peerDay = insightPeerDaily(data);
  if (peerDay) add(peerDay);
  else add(insightPeerSteadiness(data));
  if (out.length >= MAX_INSIGHTS) return out.slice(0, MAX_INSIGHTS);

  add(insightVolatility(data));
  if (out.length >= MAX_INSIGHTS) return out.slice(0, MAX_INSIGHTS);

  add(insightRiskReturn(data));
  if (out.length >= MAX_INSIGHTS) return out.slice(0, MAX_INSIGHTS);

  add(insightDrawdown(data));
  if (out.length >= MAX_INSIGHTS) return out.slice(0, MAX_INSIGHTS);

  add(insightOneYear(data));
  if (out.length >= MAX_INSIGHTS) return out.slice(0, MAX_INSIGHTS);

  add(insightScale(data));

  return out.slice(0, MAX_INSIGHTS);
}

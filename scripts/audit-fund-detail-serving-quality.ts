/**
 * Fund detail core serving artifact + (opsiyonel) runtime örneklem kalite envanteri.
 *
 * Sınıflar (çıktıda açıklanır):
 * - dense_artifact: chart point >= DENSE_MIN_POINTS ve mod snapshot_compact/none değil
 * - sparse_artifact: aksi veya snapshot_compact/none mod *
 * Kullanım:
 *   pnpm exec tsx scripts/audit-fund-detail-serving-quality.ts
 *   pnpm exec tsx scripts/audit-fund-detail-serving-quality.ts --runtime-sample=120
 */
import "./load-env";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { getFundDetailPageData } from "../src/lib/services/fund-detail.service";

const DENSE_MIN_POINTS = Math.max(
  8,
  Math.min(720, Number(process.env.AUDIT_DETAIL_SERVING_DENSE_MIN_POINTS ?? 64) || 64)
);

const SERVING_FILE =
  process.env.FUND_DETAIL_CORE_SERVING_FILE_PATH?.trim() ||
  path.join(process.cwd(), ".cache", "fund-detail-core-serving.v1.json");

type ArtifactRecord = {
  code: string;
  mode: string;
  chartPoints: number;
  artifactGeneratedAt: string | null;
  artifactSource: string | null;
  snapshotPoints: number | null;
  historyPoints: number | null;
  historyAttempted: boolean;
  historyErrorCategory: string | null;
  investorSeriesLen: number;
  portfolioSeriesLen: number;
  investorSeriesSource: string | null;
  portfolioSeriesSource: string | null;
};

type RuntimeRow = {
  code: string;
  emergency: boolean;
  priceSeriesLen: number;
  degradedReasons: string[];
  kiyasPresent: boolean;
  kiyasRefCount: number;
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function isSparseMode(mode: string): boolean {
  const m = (mode || "").trim().toLowerCase();
  return m === "snapshot_compact" || m === "none" || m === "";
}

function classifyArtifact(r: ArtifactRecord): "dense_artifact" | "sparse_artifact" {
  if (!isSparseMode(r.mode) && r.chartPoints >= DENSE_MIN_POINTS) return "dense_artifact";
  return "sparse_artifact";
}

async function loadAllActiveCodes(): Promise<string[]> {
  const codes: string[] = [];
  let after = "";
  const page = 400;
  while (true) {
    const rows = await prisma.fund.findMany({
      where: { isActive: true, ...(after ? { code: { gt: after } } : {}) },
      orderBy: { code: "asc" },
      take: page,
      select: { code: true },
    });
    if (rows.length === 0) break;
    for (const r of rows) codes.push(r.code);
    after = rows[rows.length - 1]!.code;
    if (rows.length < page) break;
  }
  return codes;
}

async function loadArtifactMap(): Promise<{
  snapshotDate: string | null;
  fileGeneratedAt: string | null;
  records: Map<string, ArtifactRecord>;
  parseError: string | null;
}> {
  try {
    const raw = await fs.readFile(SERVING_FILE, "utf8");
    const j = JSON.parse(raw) as {
      snapshotDate?: string;
      generatedAt?: string;
      records?: Record<string, unknown>;
    };
    const out = new Map<string, ArtifactRecord>();
    const rec = j.records;
    if (rec && typeof rec === "object") {
      for (const [code, payload] of Object.entries(rec)) {
        const p = payload as {
          generatedAt?: string;
          chartHistory?: {
            mode?: string;
            points?: unknown[];
            metadata?: {
              source?: string;
              snapshotPoints?: number;
              historyPoints?: number;
              historyAttempted?: boolean;
              historyErrorCategory?: string | null;
            };
          };
          investorSummary?: { series?: unknown[]; seriesMeta?: { source?: string } };
          portfolioSummary?: { series?: unknown[]; seriesMeta?: { source?: string } };
        };
        const ch = p.chartHistory;
        const meta = ch?.metadata;
        out.set(code.trim().toUpperCase(), {
          code: code.trim().toUpperCase(),
          mode: ch?.mode ?? "unknown",
          chartPoints: Array.isArray(ch?.points) ? ch.points.length : 0,
          artifactGeneratedAt: typeof p.generatedAt === "string" ? p.generatedAt : null,
          artifactSource: meta?.source ?? null,
          snapshotPoints: typeof meta?.snapshotPoints === "number" ? meta.snapshotPoints : null,
          historyPoints: typeof meta?.historyPoints === "number" ? meta.historyPoints : null,
          historyAttempted: meta?.historyAttempted === true,
          historyErrorCategory:
            typeof meta?.historyErrorCategory === "string" ? meta.historyErrorCategory : null,
          investorSeriesLen: Array.isArray(p.investorSummary?.series)
            ? p.investorSummary!.series!.length
            : 0,
          portfolioSeriesLen: Array.isArray(p.portfolioSummary?.series)
            ? p.portfolioSummary!.series!.length
            : 0,
          investorSeriesSource: typeof p.investorSummary?.seriesMeta?.source === "string"
            ? p.investorSummary.seriesMeta.source
            : null,
          portfolioSeriesSource: typeof p.portfolioSummary?.seriesMeta?.source === "string"
            ? p.portfolioSummary.seriesMeta.source
            : null,
        });
      }
    }
    return {
      snapshotDate: typeof j.snapshotDate === "string" ? j.snapshotDate : null,
      fileGeneratedAt: typeof j.generatedAt === "string" ? j.generatedAt : null,
      records: out,
      parseError: null,
    };
  } catch (e) {
    return {
      snapshotDate: null,
      fileGeneratedAt: null,
      records: new Map(),
      parseError: e instanceof Error ? e.message : String(e),
    };
  }
}

function pickRepresentative(sortedByPoints: ArtifactRecord[], n: number): {
  worst: ArtifactRecord[];
  mid: ArtifactRecord[];
  best: ArtifactRecord[];
} {
  if (sortedByPoints.length === 0) return { worst: [], mid: [], best: [] };
  const worst = sortedByPoints.slice(0, n);
  const best = sortedByPoints.slice(-n).reverse();
  const midStart = Math.max(0, Math.floor(sortedByPoints.length / 2) - Math.floor(n / 2));
  const mid = sortedByPoints.slice(midStart, midStart + n);
  return { worst, mid, best };
}

async function main() {
  const argv = process.argv.slice(2);
  let runtimeSample = 0;
  for (const a of argv) {
    const m = /^--runtime-sample=(\d+)$/.exec(a);
    if (m) runtimeSample = Math.min(2000, Math.max(0, Number(m[1])));
  }

  const [activeCodes, artifact] = await Promise.all([loadAllActiveCodes(), loadArtifactMap()]);

  const activeSet = new Set(activeCodes.map((c) => c.toUpperCase()));
  const rows: ArtifactRecord[] = [];
  for (const code of activeCodes) {
    const r = artifact.records.get(code.toUpperCase());
    if (r) rows.push(r);
  }

  const missingArtifact = activeCodes.filter((c) => !artifact.records.has(c.toUpperCase())).length;
  const extraArtifactKeys = [...artifact.records.keys()].filter((k) => !activeSet.has(k)).length;

  const withArtifact = rows.length;
  const modes = new Map<string, number>();
  const artifactSources = new Map<string, number>();
  const historyErr = new Map<string, number>();
  let snapshotCompactish = 0;
  let hybridish = 0;
  let denseCount = 0;
  let sparseCount = 0;
  let historyAttemptedTrue = 0;
  let historyAttemptedWithErr = 0;

  const pointCounts: number[] = [];
  const investorLens: number[] = [];
  const portfolioLens: number[] = [];
  const TREND_DENSE_MIN = 32;

  for (const r of rows) {
    modes.set(r.mode, (modes.get(r.mode) ?? 0) + 1);
    if (r.artifactSource) artifactSources.set(r.artifactSource, (artifactSources.get(r.artifactSource) ?? 0) + 1);
    if (isSparseMode(r.mode)) snapshotCompactish += 1;
    if ((r.mode || "").startsWith("hybrid_")) hybridish += 1;
    if (classifyArtifact(r) === "dense_artifact") denseCount += 1;
    else sparseCount += 1;
    pointCounts.push(r.chartPoints);
    investorLens.push(r.investorSeriesLen);
    portfolioLens.push(r.portfolioSeriesLen);
    if (r.historyAttempted) {
      historyAttemptedTrue += 1;
      if (r.historyErrorCategory) historyAttemptedWithErr += 1;
      if (r.historyErrorCategory) {
        historyErr.set(r.historyErrorCategory, (historyErr.get(r.historyErrorCategory) ?? 0) + 1);
      }
    }
  }

  pointCounts.sort((a, b) => a - b);
  investorLens.sort((a, b) => a - b);
  portfolioLens.sort((a, b) => a - b);
  const invDense = rows.filter((r) => r.investorSeriesLen >= TREND_DENSE_MIN).length;
  const invSparse = rows.length - invDense;
  const portDense = rows.filter((r) => r.portfolioSeriesLen >= TREND_DENSE_MIN).length;
  const portSparse = rows.length - portDense;
  const invHybridMeta = rows.filter((r) => r.investorSeriesSource === "merged_history_hybrid").length;
  const portHybridMeta = rows.filter((r) => r.portfolioSeriesSource === "merged_history_hybrid").length;
  const sortedRecords = [...rows].sort((a, b) => a.chartPoints - b.chartPoints);
  const sortedByInvestor = [...rows].sort((a, b) => a.investorSeriesLen - b.investorSeriesLen);
  const rep = pickRepresentative(sortedRecords, 10);
  const repInvWorst = sortedByInvestor.slice(0, 10);
  const repInvBest = sortedByInvestor.slice(-10).reverse();

  const aggregate = {
    definitions: {
      DENSE_MIN_POINTS,
      dense_artifact: `chartPoints >= ${DENSE_MIN_POINTS} ve mod snapshot_compact/none/boş değil`,
      sparse_artifact: "dense koşulu sağlanmazsa",
      snapshotCompactish: "mod metni snapshot_compact, none veya boş",
    },
    servingFile: SERVING_FILE,
    fileParseError: artifact.parseError,
    fileSnapshotDate: artifact.snapshotDate,
    fileGeneratedAt: artifact.fileGeneratedAt,
    dbActiveFunds: activeCodes.length,
    artifactRecordsInFile: artifact.records.size,
    artifactMatchedActiveFunds: withArtifact,
    missingArtifactOnActiveFunds: missingArtifact,
    artifactKeysNotInActiveFunds: extraArtifactKeys,
    artifactCoverageOfActive: activeCodes.length > 0 ? withArtifact / activeCodes.length : null,
    modeHistogram: Object.fromEntries([...modes.entries()].sort((a, b) => b[1] - a[1])),
    artifactMetadataSourceHistogram: Object.fromEntries(
      [...artifactSources.entries()].sort((a, b) => b[1] - a[1])
    ),
    counts: {
      dense_artifact: denseCount,
      sparse_artifact: sparseCount,
      modes_hybrid_prefix: hybridish,
      modes_snapshot_compactish: snapshotCompactish,
      historyAttempted_true: historyAttemptedTrue,
      historyAttempted_with_error_category: historyAttemptedWithErr,
    },
    historyErrorHistogram: Object.fromEntries([...historyErr.entries()].sort((a, b) => b[1] - a[1])),
    chartPointPercentiles: {
      p25: percentile(pointCounts, 25),
      p50: percentile(pointCounts, 50),
      p75: percentile(pointCounts, 75),
      min: pointCounts.length ? pointCounts[0]! : null,
      max: pointCounts.length ? pointCounts[pointCounts.length - 1]! : null,
    },
    trendSeries: {
      definitions: { TREND_DENSE_MIN },
      investor: {
        denseCount: invDense,
        sparseCount: invSparse,
        seriesMetaMergedHybrid: invHybridMeta,
        percentiles: {
          p25: percentile(investorLens, 25),
          p50: percentile(investorLens, 50),
          p75: percentile(investorLens, 75),
          min: investorLens.length ? investorLens[0]! : null,
          max: investorLens.length ? investorLens[investorLens.length - 1]! : null,
        },
      },
      portfolio: {
        denseCount: portDense,
        sparseCount: portSparse,
        seriesMetaMergedHybrid: portHybridMeta,
        percentiles: {
          p25: percentile(portfolioLens, 25),
          p50: percentile(portfolioLens, 50),
          p75: percentile(portfolioLens, 75),
          min: portfolioLens.length ? portfolioLens[0]! : null,
          max: portfolioLens.length ? portfolioLens[portfolioLens.length - 1]! : null,
        },
      },
      representativeInvestorWorst10: repInvWorst,
      representativeInvestorBest10: repInvBest,
    },
    representativeSamples: {
      worst10_by_chartPoints: rep.worst,
      mid10_by_chartPoints: rep.mid,
      best10_by_chartPoints: rep.best,
    },
  };

  let runtime: { sampleSize: number; rows: RuntimeRow[]; summary: Record<string, number | null> } | null = null;

  if (runtimeSample > 0) {
    const pool = [...activeCodes];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    const pick = pool.slice(0, Math.min(runtimeSample, pool.length));
    const rrows: RuntimeRow[] = [];
    for (const code of pick) {
      try {
        const data = await getFundDetailPageData(code);
        const reasons = data?.degraded?.reasons ?? [];
        const emergency = reasons.some((x) => x.includes("emergency"));
        const kb = data?.kiyasBlock;
        const kiyasRefCount = kb?.refs?.length ?? 0;
        rrows.push({
          code,
          emergency,
          priceSeriesLen: data?.priceSeries?.length ?? 0,
          degradedReasons: reasons,
          kiyasPresent: kb != null,
          kiyasRefCount,
        });
      } catch {
        rrows.push({
          code,
          emergency: true,
          priceSeriesLen: 0,
          degradedReasons: ["audit_runtime_error"],
          kiyasPresent: false,
          kiyasRefCount: 0,
        });
      }
    }
    const emergencyN = rrows.filter((r) => r.emergency).length;
    runtime = {
      sampleSize: rrows.length,
      rows: rrows,
      summary: {
        emergency_count: emergencyN,
        emergency_rate: rrows.length ? emergencyN / rrows.length : null,
        median_price_series_len: percentile(
          [...rrows.map((r) => r.priceSeriesLen)].sort((a, b) => a - b),
          50
        ),
      },
    };
  }

  const report = { capturedAt: new Date().toISOString(), aggregate, runtime };
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((e) => {
    console.error("[audit-fund-detail-serving-quality] failed", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

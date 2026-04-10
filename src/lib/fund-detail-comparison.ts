import type { KiyasPeriodId, KiyasPeriodRow, KiyasRefKey, FundKiyasViewPayload } from "@/lib/services/fund-detail-kiyas.service";

export type BenchmarkComparisonOutcome = "outperform" | "underperform" | "neutral";

export type BenchmarkComparisonRow = {
  key: KiyasRefKey;
  label: string;
  typeLabel: string;
  periodId: KiyasPeriodId;
  fundReturn: number;
  benchmarkReturn: number;
  difference: number;
  outcome: BenchmarkComparisonOutcome;
};

export type BenchmarkComparisonView = {
  rows: BenchmarkComparisonRow[];
  unavailableRefs: Array<{ key: KiyasRefKey; label: string; typeLabel: string }>;
  passedCount: number;
  strongestRow: BenchmarkComparisonRow | null;
  primaryRow: BenchmarkComparisonRow | null;
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

function outcomeFromDifference(difference: number, nearEps: number): BenchmarkComparisonOutcome {
  if (Math.abs(difference) <= nearEps) return "neutral";
  return difference > 0 ? "outperform" : "underperform";
}

function normalizeRow(
  key: KiyasRefKey,
  row: KiyasPeriodRow,
  label: string,
  nearEps: number
): BenchmarkComparisonRow | null {
  if (!finite(row.fundPct) || !finite(row.refPct)) return null;
  const difference = row.fundPct - row.refPct;
  return {
    key,
    label,
    typeLabel: comparisonRefType(key),
    periodId: row.periodId,
    fundReturn: row.fundPct,
    benchmarkReturn: row.refPct,
    difference,
    outcome: outcomeFromDifference(difference, nearEps),
  };
}

export function buildBenchmarkComparisonView(input: {
  block: FundKiyasViewPayload | null;
  periodId: KiyasPeriodId;
  labels?: Record<string, string>;
  preferredOrder?: KiyasRefKey[];
  nearEps?: number;
}): BenchmarkComparisonView {
  const {
    block,
    periodId,
    labels,
    preferredOrder = ["category", "bist100", "usdtry", "eurtry", "gold", "policy"],
    nearEps = 0.15,
  } = input;

  if (!block) {
    return {
      rows: [],
      unavailableRefs: [],
      passedCount: 0,
      strongestRow: null,
      primaryRow: null,
    };
  }

  const rows: BenchmarkComparisonRow[] = [];
  const unavailableRefs: Array<{ key: KiyasRefKey; label: string; typeLabel: string }> = [];

  for (const key of preferredOrder) {
    const periodRows = block.rowsByRef[key];
    if (!periodRows?.length) continue;

    // Non-negotiable contract: always use selected period only.
    const row = periodRows.find((item) => item.periodId === periodId);
    const label =
      block.refs.find((item) => item.key === key)?.label ??
      labels?.[key] ??
      key.toUpperCase();

    if (!row) {
      unavailableRefs.push({ key, label, typeLabel: comparisonRefType(key) });
      continue;
    }

    const normalized = normalizeRow(key, row, label, nearEps);
    if (!normalized) {
      unavailableRefs.push({ key, label, typeLabel: comparisonRefType(key) });
      continue;
    }

    rows.push(normalized);
  }

  const passedCount = rows.filter((row) => row.outcome === "outperform").length;
  const strongestRow =
    rows.length > 0
      ? [...rows].sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))[0] ?? null
      : null;

  return {
    rows,
    unavailableRefs,
    passedCount,
    strongestRow,
    primaryRow: rows[0] ?? null,
  };
}

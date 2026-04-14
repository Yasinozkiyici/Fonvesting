"use client";

import Link from "next/link";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { fundDetailHref } from "@/lib/fund-routes";
import {
  formatCompactCurrency,
  formatCompactNumber,
} from "@/lib/fund-list-format";
import {
  COMPARE_CODES_CHANGED_EVENT,
  readCompareCodes,
  removeCompareCode,
  writeCompareCodes,
} from "@/lib/compare-selection";
import { fundTypeDisplayLabel } from "@/lib/fund-type-display";

type KiyasRefKey = "category" | "policy" | "bist100" | "gold" | "usdtry" | "eurtry";
type KiyasPeriodId = "1m" | "3m" | "6m" | "1y" | "2y" | "3y";
type KiyasBand = "above" | "near" | "below";

type ComparePeriodRow = {
  periodId: KiyasPeriodId;
  label: string;
  fundPct: number | null;
  refPct: number | null;
  band: KiyasBand | null;
  diffPct: number | null;
};

type CompareContext = {
  anchorDate: string;
  refs: { key: KiyasRefKey; label: string }[];
  defaultRef: KiyasRefKey;
  periods: { id: KiyasPeriodId; label: string }[];
  summaryByRef: Partial<Record<KiyasRefKey, string>>;
  matrix: Record<string, Partial<Record<KiyasRefKey, ComparePeriodRow[]>>>;
};

type Row = {
  code: string;
  name: string;
  shortName: string | null;
  logoUrl?: string | null;
  lastPrice: number;
  dailyReturn: number;
  monthlyReturn: number;
  yearlyReturn: number;
  portfolioSize: number;
  investorCount: number;
  category: { code: string; name: string } | null;
  fundType: { code: number; name: string } | null;
  volatility1y: number | null;
  maxDrawdown1y: number | null;
  variabilityLabel: "Sakin" | "Orta" | "Geniş" | null;
};

type CompareInsight = {
  label: string;
  code: string;
  detail: string;
};

type ComparedFund = {
  row: Row;
  compareRow?: ComparePeriodRow;
  periodReturn: number | null;
  referenceReturn: number | null;
  delta: number | null;
  band: KiyasBand | null;
  deltaLabel: string;
  statusLabel: string;
  deltaTone: string;
  deltaSurface: string;
  deltaBorder: string;
  drawdownLabel: string;
  investorLabel: string;
  portfolioLabel: string;
  variabilityLabel: string;
  refReturnLabel: string;
  cardBarWidth: number;
};

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2).replace(".", ",")}%`;
}

function fmtNeutralPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `%${Math.abs(n).toFixed(2).replace(".", ",")}`;
}

function bandLabel(band: KiyasBand | null | undefined): string {
  if (band === "above") return "Üstünde";
  if (band === "below") return "Altında";
  if (band === "near") return "Yakın";
  return "—";
}

function bandTone(band: KiyasBand | null | undefined): string {
  if (band === "above") return "var(--success-muted)";
  if (band === "below") return "var(--danger-muted)";
  return "var(--text-tertiary)";
}

function codeKey(code: string): string {
  return code.trim().toUpperCase();
}

function lookupRow(
  matrix: CompareContext["matrix"],
  code: string,
  ref: KiyasRefKey,
  periodId: KiyasPeriodId
): ComparePeriodRow | undefined {
  return matrix[codeKey(code)]?.[ref]?.find((r) => r.periodId === periodId);
}

function compareNullableDesc(a: number | null | undefined, b: number | null | undefined): number {
  const av = a != null && Number.isFinite(a) ? a : Number.NEGATIVE_INFINITY;
  const bv = b != null && Number.isFinite(b) ? b : Number.NEGATIVE_INFINITY;
  return bv - av;
}

function compareNullableAsc(a: number | null | undefined, b: number | null | undefined): number {
  const av = a != null && Number.isFinite(a) ? a : Number.POSITIVE_INFINITY;
  const bv = b != null && Number.isFinite(b) ? b : Number.POSITIVE_INFINITY;
  return av - bv;
}

function variabilityRank(label: Row["variabilityLabel"]): number {
  if (label === "Sakin") return 0;
  if (label === "Orta") return 1;
  if (label === "Geniş") return 2;
  return 3;
}

function deltaBarWidth(delta: number | null | undefined): number {
  if (delta == null || !Number.isFinite(delta)) return 12;
  return Math.max(14, Math.min(100, 18 + Math.abs(delta) * 3.8));
}

function toneForBand(band: KiyasBand | null | undefined) {
  if (band === "above") {
    return {
      text: "var(--success-muted)",
      surface: "color-mix(in srgb, var(--success-muted) 11%, var(--card-bg))",
      border: "color-mix(in srgb, var(--success-muted) 18%, var(--border-subtle))",
    };
  }
  if (band === "below") {
    return {
      text: "var(--danger-muted)",
      surface: "color-mix(in srgb, var(--danger-muted) 11%, var(--card-bg))",
      border: "color-mix(in srgb, var(--danger-muted) 18%, var(--border-subtle))",
    };
  }
  return {
    text: "var(--text-secondary)",
    surface: "color-mix(in srgb, var(--bg-muted) 52%, var(--card-bg))",
    border: "color-mix(in srgb, var(--border-subtle) 86%, transparent)",
  };
}

function compareCardTitle(row: Row): string {
  return row.name;
}

function compareAgainstLabel(refLabel: string): string {
  return `${refLabel} karşısında`;
}

const CompareSummaryCard = memo(function CompareSummaryCard({
  label,
  code,
  detail,
}: CompareInsight) {
  return (
    <div
      className="rounded-[18px] border px-3 py-2.5 sm:px-3.5"
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
        background: "color-mix(in srgb, var(--card-bg) 97%, var(--bg-muted))",
      }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <div className="mt-1.5 flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
        <span className="text-[14px] font-semibold tracking-[-0.02em]" style={{ color: "var(--text-primary)" }}>
          {code}
        </span>
        <span
          className="min-w-0 break-words text-[11px] leading-snug sm:text-[12px] max-md:line-clamp-3"
          style={{ color: "var(--text-secondary)" }}
          title={detail}
        >
          {detail}
        </span>
      </div>
    </div>
  );
});

const CompareVisualCard = memo(function CompareVisualCard({
  item,
  periodLabel,
  activeRefLabel,
}: {
  item: ComparedFund;
  periodLabel: string;
  activeRefLabel: string;
}) {
  return (
    <article
      className="flex h-full min-w-0 max-w-full flex-col overflow-hidden rounded-[18px] border px-3 py-3 sm:px-4"
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 80%, transparent)",
        background: "color-mix(in srgb, var(--card-bg) 98%, white)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold"
              style={{
                borderColor: "color-mix(in srgb, var(--border-subtle) 78%, transparent)",
                background: "color-mix(in srgb, var(--bg-muted) 55%, var(--card-bg))",
                color: "var(--text-primary)",
              }}
            >
              {item.row.code.slice(0, 2)}
            </div>
            <div className="min-w-0">
              <Link
                href={fundDetailHref(item.row.code)}
                prefetch={false}
                className="block truncate text-[13px] font-semibold tracking-[-0.02em] hover:underline"
                style={{ color: "var(--text-primary)" }}
              >
                {item.row.code}
              </Link>
              <p
                className="text-[11px] leading-snug break-words sm:truncate"
                style={{ color: "var(--text-tertiary)" }}
                title={compareCardTitle(item.row)}
              >
                {compareCardTitle(item.row)}
              </p>
            </div>
          </div>
        </div>
        <span
          className="inline-flex max-w-full self-start rounded-full border px-2 py-0.5 text-[10px] font-semibold"
          style={{
            color: item.deltaTone,
            borderColor: item.deltaBorder,
            background: item.deltaSurface,
          }}
        >
          {item.statusLabel}
        </span>
      </div>

      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
            {periodLabel} getiri
          </p>
          <p className="mt-1 text-[14px] font-semibold tracking-[-0.02em]" style={{ color: "var(--text-primary)" }}>
            {item.periodReturn != null ? fmtPct(item.periodReturn) : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
            {compareAgainstLabel(activeRefLabel)}
          </p>
          <p className="mt-1 text-[13px] font-semibold tracking-[-0.02em]" style={{ color: item.deltaTone }}>
            {item.deltaLabel}
          </p>
        </div>
        <div className="flex items-start sm:items-end sm:justify-end">
          <span className="text-[12px] font-semibold tracking-[-0.02em] break-words" style={{ color: "var(--text-primary)" }}>
            {item.drawdownLabel}
          </span>
        </div>
      </div>

      <div className="mt-3">
        <div
          className="relative h-[8px] rounded-full"
          style={{
            background: "color-mix(in srgb, var(--bg-muted) 74%, var(--card-bg))",
            border: "1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent)",
          }}
          aria-hidden
        >
          <span
            className="absolute left-1/2 top-1/2 h-[12px] w-px -translate-x-1/2 -translate-y-1/2"
            style={{ background: "color-mix(in srgb, var(--text-tertiary) 50%, transparent)" }}
          />
          <span
            className="absolute top-1/2 h-[4px] -translate-y-1/2 rounded-full"
            style={{
              left: item.band === "below" ? undefined : "50%",
              right: item.band === "below" ? "50%" : undefined,
              marginLeft: item.band === "below" ? undefined : "3px",
              marginRight: item.band === "below" ? "3px" : undefined,
              width: `${item.cardBarWidth}px`,
              background: item.deltaTone,
              opacity: 0.88,
            }}
          />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
        <span>{item.statusLabel}</span>
        <span className="min-w-0 text-right break-words">{activeRefLabel}: {item.refReturnLabel}</span>
      </div>
    </article>
  );
});

const CompareTableRow = memo(function CompareTableRow({
  item,
  onDrop,
}: {
  item: ComparedFund;
  onDrop: (code: string) => void;
}) {
  return (
    <tr className="border-t" style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 78%, transparent)" }}>
      <td className="pl-2.5 pr-7 py-3 sm:pl-3 sm:pr-8">
        <div className="flex items-start gap-2.5">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold"
            style={{
              borderColor: "color-mix(in srgb, var(--border-subtle) 78%, transparent)",
              background: "color-mix(in srgb, var(--bg-muted) 55%, var(--card-bg))",
              color: "var(--text-primary)",
            }}
          >
            {item.row.code.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <Link
              href={fundDetailHref(item.row.code)}
              className="font-semibold tabular-nums hover:underline"
              style={{ color: "var(--text-primary)" }}
            >
              {item.row.code}
            </Link>
            <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
              {compareCardTitle(item.row)}
            </p>
            <p className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
              {fundTypeDisplayLabel(item.row.fundType)}
            </p>
          </div>
        </div>
      </td>
      <td className="px-1.5 py-3 text-right tabular-nums table-num font-medium sm:px-2" style={{ color: "var(--text-primary)" }}>
        {item.periodReturn != null ? fmtPct(item.periodReturn) : "—"}
      </td>
      <td className="px-1.5 py-3 sm:px-2">
        <div className="flex items-center justify-end">
          <span
            className="inline-flex whitespace-nowrap rounded-full border px-2 py-[0.32rem] text-[9.5px] font-semibold tabular-nums sm:text-[10px]"
            style={{
              color: item.deltaTone,
              borderColor: item.deltaBorder,
              background: item.deltaSurface,
            }}
            title={`Fon: ${item.periodReturn != null ? fmtPct(item.periodReturn) : "—"} · Referans: ${item.refReturnLabel}`}
          >
            {item.deltaLabel} {bandLabel(item.band).toLowerCase()}
          </span>
        </div>
      </td>
      <td className="px-1.5 py-3 text-[10.5px] sm:px-2" style={{ color: "var(--text-secondary)" }}>
        {item.variabilityLabel}
      </td>
      <td className="px-1.5 py-3 text-right tabular-nums table-num text-[10.5px] sm:px-2" style={{ color: "var(--text-secondary)" }}>
        {item.drawdownLabel}
      </td>
      <td className="px-1.5 py-3 text-right tabular-nums table-num text-[10.5px] sm:px-2" style={{ color: "var(--text-secondary)" }}>
        {item.portfolioLabel}
      </td>
      <td className="px-1.5 py-3 text-right tabular-nums table-num text-[10.5px] sm:px-2" style={{ color: "var(--text-secondary)" }}>
        {item.investorLabel}
      </td>
      <td className="pl-1.5 pr-2 py-3 text-right sm:pl-2 sm:pr-2.5">
        <button
          type="button"
          onClick={() => onDrop(item.row.code)}
          className="rounded-full border px-1.5 py-[0.32rem] text-[9.5px] font-medium transition-colors hover:text-[var(--text-primary)] sm:px-2 sm:text-[10px]"
          style={{
            color: "var(--text-secondary)",
            borderColor: "color-mix(in srgb, var(--border-subtle) 84%, transparent)",
            background: "color-mix(in srgb, var(--card-bg) 97%, var(--bg-muted))",
          }}
        >
          Çıkar
        </button>
      </td>
    </tr>
  );
});

const CompareMobileDetailCard = memo(function CompareMobileDetailCard({
  item,
  activeRefCompareLabel,
  periodLabel,
  onDrop,
}: {
  item: ComparedFund;
  activeRefCompareLabel: string;
  periodLabel: string;
  onDrop: (code: string) => void;
}) {
  return (
    <article
      className="min-w-0 max-w-full rounded-[18px] border px-3 py-3"
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 80%, transparent)",
        background: "color-mix(in srgb, var(--card-bg) 98%, var(--bg-muted))",
      }}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold"
          style={{
            borderColor: "color-mix(in srgb, var(--border-subtle) 78%, transparent)",
            background: "color-mix(in srgb, var(--bg-muted) 55%, var(--card-bg))",
            color: "var(--text-primary)",
          }}
        >
          {item.row.code.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="min-w-0">
              <Link
                href={fundDetailHref(item.row.code)}
                prefetch={false}
                className="block truncate text-[13px] font-semibold tabular-nums hover:underline"
                style={{ color: "var(--text-primary)" }}
              >
                {item.row.code}
              </Link>
              <p className="mt-0.5 break-words text-[11px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
                {compareCardTitle(item.row)}
              </p>
              <p className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
                {fundTypeDisplayLabel(item.row.fundType)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <MetricPill label={periodLabel} value={item.periodReturn != null ? fmtPct(item.periodReturn) : "—"} />
              <MetricPill label={activeRefCompareLabel} value={`${item.deltaLabel} ${bandLabel(item.band).toLowerCase()}`} tone={item.deltaTone} />
              <MetricPill label="Profil" value={item.variabilityLabel} />
              <MetricPill label="Geri çekilme" value={item.drawdownLabel} />
              <MetricPill label="Portföy" value={item.portfolioLabel} />
              <MetricPill label="Yatırımcı" value={item.investorLabel} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span
          className="inline-flex max-w-full rounded-full border px-2 py-[0.32rem] text-[9.5px] font-semibold"
          style={{
            color: item.deltaTone,
            borderColor: item.deltaBorder,
            background: item.deltaSurface,
          }}
        >
          {item.statusLabel}
        </span>
        <button
          type="button"
          onClick={() => onDrop(item.row.code)}
          className="touch-manipulation min-h-11 rounded-full border px-3 py-2 text-[11px] font-semibold transition-colors hover:text-[var(--text-primary)]"
          style={{
            color: "var(--text-secondary)",
            borderColor: "color-mix(in srgb, var(--border-subtle) 84%, transparent)",
            background: "color-mix(in srgb, var(--card-bg) 97%, var(--bg-muted))",
          }}
        >
          Çıkar
        </button>
      </div>
    </article>
  );
});

function MetricPill({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div
      className="min-w-0 rounded-[12px] border px-2.5 py-2"
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 80%, transparent)",
        background: "color-mix(in srgb, var(--card-bg) 96%, white)",
      }}
    >
      <p className="text-[9px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p
        className="mt-1 break-words text-[11px] font-semibold leading-snug tracking-[-0.02em]"
        style={{ color: tone ?? "var(--text-primary)" }}
      >
        {value}
      </p>
    </div>
  );
}

export function ComparePageClient() {
  const [codes, setCodes] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [compare, setCompare] = useState<CompareContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refKey, setRefKey] = useState<KiyasRefKey | null>(null);
  const [periodId, setPeriodId] = useState<KiyasPeriodId>("1y");
  const [isPending, startTransition] = useTransition();
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    const c = readCompareCodes();
    setCodes(c);
    if (c.length === 0) {
      setRows([]);
      setCompare(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/funds/compare?codes=${encodeURIComponent(c.join(","))}`, {
        signal: controller.signal,
      });
      const body = (await r.json()) as {
        funds?: Row[];
        compare?: CompareContext | null;
        error?: string;
      };
      if (!r.ok) throw new Error(body.error ?? "İstek başarısız");
      if (!controller.signal.aborted) {
        setRows(Array.isArray(body.funds) ? body.funds : []);
        setCompare(body.compare ?? null);
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Yüklenemedi");
      setRows([]);
      setCompare(null);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
      if (requestRef.current === controller) {
        requestRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (compare?.defaultRef) {
      setRefKey((prev) => {
        if (prev && compare.refs.some((x) => x.key === prev)) return prev;
        return compare.defaultRef;
      });
    } else {
      setRefKey(null);
    }
  }, [compare]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "fonvesting_compare_codes_v1") {
        void load();
      }
    };
    const onCompareChange = () => {
      void load();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("storage", onStorage);
    window.addEventListener(COMPARE_CODES_CHANGED_EVENT, onCompareChange);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(COMPARE_CODES_CHANGED_EVENT, onCompareChange);
    };
  }, [load]);

  const activeRef = refKey ?? compare?.defaultRef ?? null;
  const activeRefLabel = useMemo(
    () => (activeRef ? compare?.refs.find((item) => item.key === activeRef)?.label ?? "Referans" : "Referans"),
    [activeRef, compare]
  );
  const activeRefCompareLabel = useMemo(() => compareAgainstLabel(activeRefLabel), [activeRefLabel]);
  const periodLabel = useMemo(
    () => compare?.periods.find((p) => p.id === periodId)?.label ?? "Dönem",
    [compare, periodId]
  );

  const comparedFunds = useMemo<ComparedFund[]>(() => {
    return rows.map((row) => {
      const compareRow = compare && activeRef ? lookupRow(compare.matrix, row.code, activeRef, periodId) : undefined;
      const periodReturn = compareRow?.fundPct ?? null;
      const referenceReturn = compareRow?.refPct ?? null;
      const delta = compareRow?.diffPct ?? null;
      const band = compareRow?.band ?? null;
      const tone = toneForBand(band);
      return {
        row,
        compareRow,
        periodReturn,
        referenceReturn,
        delta,
        band,
        deltaLabel: delta != null && Number.isFinite(delta) ? fmtPct(delta) : "—",
        statusLabel: band === "above" ? "Önde" : band === "below" ? "Geride" : "Yakın",
        deltaTone: tone.text,
        deltaSurface: tone.surface,
        deltaBorder: tone.border,
        drawdownLabel:
          row.maxDrawdown1y != null && Number.isFinite(row.maxDrawdown1y)
            ? fmtPct(-Math.abs(row.maxDrawdown1y))
            : "—",
        investorLabel: row.investorCount > 0 ? formatCompactNumber(row.investorCount) : "—",
        portfolioLabel: formatCompactCurrency(row.portfolioSize),
        variabilityLabel: row.variabilityLabel ?? "Belirsiz",
        refReturnLabel: referenceReturn != null ? fmtNeutralPct(referenceReturn) : "—",
        cardBarWidth: deltaBarWidth(delta),
      };
    });
  }, [activeRef, compare, periodId, rows]);

  const compareModel = useMemo(() => {
    const sortedByPerformance = [...comparedFunds].sort((a, b) => compareNullableDesc(a.periodReturn, b.periodReturn));
    const strongest = sortedByPerformance[0] ?? null;
    const referenceLeader = [...comparedFunds].sort((a, b) => compareNullableDesc(a.delta, b.delta))[0] ?? null;
    const calmest = [...comparedFunds].sort((a, b) => {
      const rankDiff = variabilityRank(a.row.variabilityLabel) - variabilityRank(b.row.variabilityLabel);
      if (rankDiff !== 0) return rankDiff;
      return compareNullableAsc(a.row.maxDrawdown1y, b.row.maxDrawdown1y);
    })[0] ?? null;
    const shallowestDrawdown = [...comparedFunds].sort((a, b) => compareNullableAsc(a.row.maxDrawdown1y, b.row.maxDrawdown1y))[0] ?? null;
    return {
      sortedByPerformance,
      strongest,
      referenceLeader,
      calmest,
      shallowestDrawdown,
    };
  }, [comparedFunds]);

  const summaryLine = useMemo(() => {
    if (!compareModel.strongest && !compareModel.referenceLeader) return null;
    if (compareModel.strongest && compareModel.referenceLeader) {
      return `${periodLabel} görünümünde ${compareModel.strongest.row.code} en yüksek getiride, ${compareModel.referenceLeader.row.code} ise ${activeRefCompareLabel} en önde.`;
    }
    if (compareModel.strongest) {
      return `${periodLabel} görünümünde en yüksek getiri ${compareModel.strongest.row.code} tarafında.`;
    }
    return `${activeRefCompareLabel} en güçlü fark ${compareModel.referenceLeader?.row.code ?? "—"} tarafında.`;
  }, [activeRefCompareLabel, compareModel, periodLabel]);

  const decisionInsights = useMemo<CompareInsight[]>(() => {
    if (!compare || !activeRef || comparedFunds.length === 0) return [];

    const insights: CompareInsight[] = [];
    if (compareModel.strongest?.periodReturn != null) {
      insights.push({
        label: "En güçlü performans",
        code: compareModel.strongest.row.code,
        detail: `${periodLabel} ${fmtPct(compareModel.strongest.periodReturn)}`,
      });
    }
    if (compareModel.calmest?.row.variabilityLabel) {
      insights.push({
        label: "En sakin profil",
        code: compareModel.calmest.row.code,
        detail: `${compareModel.calmest.row.variabilityLabel} · geri çekilme ${compareModel.calmest.drawdownLabel}`,
      });
    }
    if (compareModel.referenceLeader?.delta != null) {
      insights.push({
        label: "Referansa göre en önde",
        code: compareModel.referenceLeader.row.code,
        detail: `${activeRefCompareLabel} ${compareModel.referenceLeader.deltaLabel}`,
      });
    }
    if (compareModel.shallowestDrawdown?.row.maxDrawdown1y != null) {
      insights.push({
        label: "En düşük geri çekilme",
        code: compareModel.shallowestDrawdown.row.code,
        detail: compareModel.shallowestDrawdown.drawdownLabel,
      });
    }
    return insights.slice(0, 4);
  }, [activeRef, activeRefCompareLabel, compare, compareModel, comparedFunds.length, periodLabel]);

  const drop = useCallback(
    (code: string) => {
      const next = removeCompareCode(code);
      setCodes(next);
      setRows((prev) => prev.filter((x) => x.code !== code));
      if (next.length === 0) {
        setRows([]);
        setCompare(null);
      } else {
        void load();
      }
    },
    [load]
  );

  const clear = useCallback(() => {
    writeCompareCodes([]);
    setCodes([]);
    setRows([]);
    setCompare(null);
  }, []);

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 sm:space-y-5">
      {codes.length === 0 && !loading ? (
        <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Henüz kod yok.{" "}
          <Link href="/" prefetch={false} className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--text-primary)" }}>
            Ana listede
          </Link>{" "}
          veya bir fon sayfasında &quot;Karşılaştırma ekle&quot; ile seçim yapın.
        </p>
      ) : null}

      {codes.length > 0 && codes.length < 2 ? (
        <p className="text-[12px] leading-snug sm:text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          İki veya daha fazla fon eklediğinizde karar özeti ve sıralı kıyas daha anlamlı hale gelir.
        </p>
      ) : null}

      {error ? (
        <p className="text-sm" style={{ color: "var(--danger-muted, #b91c1c)" }}>
          {error}
        </p>
      ) : null}

      {loading && codes.length > 0 ? (
        <div className="min-h-[3.5rem] rounded-[18px] border border-dashed px-3 py-3 sm:min-h-[4rem]" style={{ borderColor: "var(--border-subtle)", background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))" }}>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Karşılaştırma hazırlanıyor…
          </p>
        </div>
      ) : null}

      {rows.length > 0 && compare && activeRef ? (
        <section
          className="w-full min-w-0 max-w-full rounded-[24px] border px-3 py-3.5 sm:px-4 sm:py-4.5"
          style={{
            borderColor: "var(--border-subtle)",
            background: "color-mix(in srgb, var(--card-bg) 97%, white)",
            boxShadow: "var(--shadow-xs)",
          }}
        >
          <div className="flex min-w-0 flex-col gap-3.5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
                  Karşılaştırma
                </p>
                <p className="mt-1 text-[14px] font-semibold tracking-[-0.02em] sm:text-[15px]" style={{ color: "var(--text-primary)" }}>
                  {summaryLine ?? `${activeRefLabel} · ${periodLabel}`}
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                <div
                  className="inline-flex max-w-full flex-wrap gap-1 rounded-[14px] border p-1"
                  style={{
                    borderColor: "color-mix(in srgb, var(--border-subtle) 84%, transparent)",
                    background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
                  }}
                  role="tablist"
                  aria-label="Referans"
                >
              {compare.refs.map((r) => {
                    const active = r.key === activeRef;
                    return (
                      <button
                        key={r.key}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => startTransition(() => setRefKey(r.key))}
                        className="rounded-[10px] px-2.5 py-1.5 text-[11px] font-medium transition-colors sm:text-[12px]"
                        style={{
                          border: "1px solid",
                          borderColor: active
                            ? "var(--segment-active-border)"
                            : "transparent",
                          color: active ? "var(--text-primary)" : "var(--text-secondary)",
                          background: active ? "var(--surface-control)" : "transparent",
                          boxShadow: active ? "var(--shadow-xs)" : "none",
                        }}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>
                <div
                  className="inline-flex max-w-full flex-wrap gap-1 rounded-[14px] border p-1"
                  style={{
                    borderColor: "color-mix(in srgb, var(--border-subtle) 84%, transparent)",
                    background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
                  }}
                  role="tablist"
                  aria-label="Dönem"
                >
                  {compare.periods.map((p) => {
                    const active = p.id === periodId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => startTransition(() => setPeriodId(p.id))}
                        className="rounded-[10px] px-2.5 py-1.5 text-[10px] font-medium transition-colors sm:text-[11px]"
                        style={{
                          border: "1px solid",
                          borderColor: active
                            ? "var(--segment-active-border)"
                            : "transparent",
                          color: active ? "var(--text-primary)" : "var(--text-muted)",
                          background: active ? "var(--surface-control)" : "transparent",
                          boxShadow: active ? "var(--shadow-xs)" : "none",
                        }}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {decisionInsights.length > 0 ? (
              <div className="grid min-w-0 gap-2 md:grid-cols-2">
              {decisionInsights.map((item) => (
                  <CompareSummaryCard key={`${item.label}-${item.code}`} {...item} />
                ))}
              </div>
            ) : null}

            <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {compareModel.sortedByPerformance.map((item) => (
                <CompareVisualCard
                  key={item.row.code}
                  item={item}
                  periodLabel={periodLabel}
                  activeRefLabel={activeRefLabel}
                />
              ))}
            </div>

            {activeRef === "policy" ? (
              <p className="text-[10px] leading-snug sm:text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                <span className="md:hidden">Politika faizi seçili vadeye ölçeklenir.</span>
                <span className="hidden md:inline">
                  Faiz referansı yıllık politika oranından seçili vadeye ölçeklenmiş yüzde getiriyi gösterir.
                </span>
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {rows.length > 0 && !compare ? (
        <p className="text-[11px] leading-snug max-md:line-clamp-2" style={{ color: "var(--text-tertiary)" }} title="Referans katmanı okunamıyor; tablo yine görünür.">
          <span className="md:hidden">Referans katmanı yüklenemedi; tablo aşağıda.</span>
          <span className="hidden md:inline">
            Referans katmanı şu an okunamıyor; temel karşılaştırma alanları yine de aşağıda görünür.
          </span>
        </p>
      ) : null}

      {rows.length > 0 ? (
        <section
          className="w-full min-w-0 max-w-full overflow-hidden rounded-[22px] border"
          style={{ borderColor: "var(--border-subtle)", background: "var(--card-bg)" }}
        >
          <div
            className="flex flex-col gap-2 border-b px-3.5 py-3 sm:px-4"
            style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)" }}
          >
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
                  Tablo
                </p>
                <p className="mt-1 text-[13px] font-semibold tracking-[-0.02em]" style={{ color: "var(--text-primary)" }}>
                  Kompakt kıyas görünümü
                </p>
              </div>
              {isPending ? (
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  Görünüm güncelleniyor…
                </span>
              ) : null}
            </div>
          </div>
          <div className="grid gap-2 px-3.5 py-3 lg:hidden">
            {compareModel.sortedByPerformance.map((item) => (
              <CompareMobileDetailCard
                key={item.row.code}
                item={item}
                activeRefCompareLabel={activeRefCompareLabel}
                periodLabel={periodLabel}
                onDrop={drop}
              />
            ))}
          </div>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[760px] table-auto text-left text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)" }}>
                  <th className="w-[42%] pl-2.5 pr-7 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] sm:pl-3 sm:pr-8" style={{ color: "var(--text-muted)" }}>
                    Fon
                  </th>
                  <th className="w-[1%] whitespace-nowrap px-1.5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.08em] table-num sm:px-2" style={{ color: "var(--text-muted)" }}>
                    {periodLabel}
                  </th>
                  <th className="w-[1%] whitespace-nowrap px-1.5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.08em] sm:px-2" style={{ color: "var(--text-muted)" }}>
                    {activeRefCompareLabel}
                  </th>
                  <th className="w-[1%] whitespace-nowrap px-1.5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] sm:px-2" style={{ color: "var(--text-muted)" }}>
                    Profil
                  </th>
                  <th className="w-[1%] whitespace-nowrap px-1.5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.08em] table-num sm:px-2" style={{ color: "var(--text-muted)" }}>
                    Geri çekilme
                  </th>
                  <th className="w-[1%] whitespace-nowrap px-1.5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.08em] table-num sm:px-2" style={{ color: "var(--text-muted)" }}>
                    Portföy
                  </th>
                  <th className="w-[1%] whitespace-nowrap px-1.5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.08em] table-num sm:px-2" style={{ color: "var(--text-muted)" }}>
                    Yatırımcı
                  </th>
                  <th className="w-[1%] whitespace-nowrap pl-1.5 pr-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.08em] sm:pl-2 sm:pr-2.5" style={{ color: "var(--text-muted)" }}>
                    <span className="sr-only">Çıkar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {compareModel.sortedByPerformance.map((item) => (
                  <CompareTableRow
                    key={item.row.code}
                    item={item}
                    onDrop={drop}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div
            className="flex flex-col gap-2 border-t px-3.5 py-3 text-[11px] sm:flex-row sm:items-center sm:justify-between sm:px-4"
            style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)", color: "var(--text-muted)" }}
          >
            {compare?.anchorDate ? (
              <span className="tabular-nums">
                Referans kesiti:{" "}
                {new Date(compare.anchorDate).toLocaleDateString("tr-TR", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Link
                href="/"
                className="touch-manipulation inline-flex min-h-10 items-center justify-center rounded-full border px-3 py-2 text-[11px] font-semibold transition-colors hover:text-[var(--text-primary)] md:min-h-0 md:px-2.5 md:py-1 md:text-sm md:font-medium"
                style={{
                  color: "var(--text-secondary)",
                  borderColor: "color-mix(in srgb, var(--border-subtle) 84%, transparent)",
                  background: "color-mix(in srgb, var(--card-bg) 97%, var(--bg-muted))",
                }}
              >
                Ana listeye dön
              </Link>
              {codes.length > 0 ? (
                <button
                  type="button"
                  onClick={clear}
                  className="touch-manipulation inline-flex min-h-10 items-center justify-center rounded-full border px-3 py-2 text-[11px] font-semibold transition-colors hover:text-[var(--text-primary)] md:min-h-0 md:px-2.5 md:py-1 md:text-sm md:font-medium"
                  style={{
                    color: "var(--text-secondary)",
                    borderColor: "color-mix(in srgb, var(--border-subtle) 84%, transparent)",
                    background: "color-mix(in srgb, var(--card-bg) 97%, var(--bg-muted))",
                  }}
                >
                  Tümünü temizle
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {codes.length > 0 && !loading && rows.length === 0 && !error ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Seçilen kodlardan hiçbiri bulunamadı. Listeyi güncelleyin.
        </p>
      ) : null}
    </div>
  );
}

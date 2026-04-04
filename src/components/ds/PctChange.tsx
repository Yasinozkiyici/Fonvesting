/** Tablo hücresi — 1G / 7G yüzde */
export function PctChangeTable({ value }: { value: number }) {
  const v = Number(value);
  if (!Number.isFinite(v) || Math.abs(v) > 100) {
    return (
      <span className="table-num tabular-nums text-[12px] sm:text-[13px]" style={{ color: "var(--text-secondary)" }}>
        —
      </span>
    );
  }
  if (v === 0) {
    return (
      <span className="table-num tabular-nums text-[12px] font-medium sm:text-[13px]" style={{ color: "var(--text-secondary)" }}>
        0,00%
      </span>
    );
  }
  const pos = v > 0;
  return (
    <span className="table-num tabular-nums text-[12px] font-semibold sm:text-[13px]" style={{ color: pos ? "var(--success)" : "var(--danger)" }}>
      {pos ? "+" : ""}
      {v.toFixed(2).replace(".", ",")}%
    </span>
  );
}

/** Mobil kart — CMC tonları (globals mobile-fund-card__pct) */
export function PctChangeMobile({ value }: { value: number }) {
  const v = Number(value);
  if (!Number.isFinite(v) || Math.abs(v) > 100) {
    return <span className="mobile-fund-card__pct mobile-fund-card__pct--muted">—</span>;
  }
  if (v === 0) {
    return <span className="mobile-fund-card__pct mobile-fund-card__pct--zero">0,00%</span>;
  }
  const pos = v > 0;
  return (
    <span className={`mobile-fund-card__pct ${pos ? "mobile-fund-card__pct--pos" : "mobile-fund-card__pct--neg"}`}>
      {pos ? "+" : ""}
      {v.toFixed(2).replace(".", ",")}%
    </span>
  );
}

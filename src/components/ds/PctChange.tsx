import { formatDailyReturnPctPointsTr } from "@/lib/daily-return-ui";

/** Tablo hücresi — 1G / 7G yüzde */
export function PctChangeTable({ value }: { value: number }) {
  const { text, sign } = formatDailyReturnPctPointsTr(Number(value));
  if (text === "—") {
    return (
      <span className="table-num tabular-nums text-[12px] sm:text-[13px]" style={{ color: "var(--text-secondary)" }}>
        —
      </span>
    );
  }
  if (sign === "neutral") {
    return (
      <span className="table-num tabular-nums text-[12px] font-medium sm:text-[13px]" style={{ color: "var(--text-secondary)" }}>
        {text}
      </span>
    );
  }
  return (
    <span
      className="table-num tabular-nums text-[12px] font-semibold sm:text-[13px]"
      style={{ color: sign === "positive" ? "var(--success)" : "var(--danger)" }}
    >
      {text}
    </span>
  );
}

/** Mobil kart — CMC tonları (globals mobile-fund-card__pct) */
export function PctChangeMobile({ value }: { value: number }) {
  const { text, sign } = formatDailyReturnPctPointsTr(Number(value));
  if (text === "—") {
    return <span className="mobile-fund-card__pct mobile-fund-card__pct--muted">—</span>;
  }
  if (sign === "neutral") {
    return <span className="mobile-fund-card__pct mobile-fund-card__pct--zero">{text}</span>;
  }
  return (
    <span className={`mobile-fund-card__pct ${sign === "positive" ? "mobile-fund-card__pct--pos" : "mobile-fund-card__pct--neg"}`}>
      {text}
    </span>
  );
}

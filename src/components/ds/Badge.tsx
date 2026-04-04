import type { RiskLevel } from "@/lib/scoring";

function riskBucketLabel(level: RiskLevel): string {
  if (level === "very_low" || level === "low") return "Düşük";
  if (level === "medium") return "Orta";
  return "Yüksek";
}

function riskSurface(level: RiskLevel): { background: string; borderColor: string; color: string } {
  if (level === "very_low" || level === "low") {
    return {
      background: "rgba(47, 125, 114, 0.07)",
      borderColor: "rgba(47, 125, 114, 0.14)",
      color: "var(--success)",
    };
  }
  if (level === "medium") {
    return {
      background: "rgba(15, 23, 42, 0.04)",
      borderColor: "rgba(15, 23, 42, 0.08)",
      color: "var(--text-secondary)",
    };
  }
  return {
    background: "rgba(179, 92, 92, 0.07)",
    borderColor: "rgba(179, 92, 92, 0.14)",
    color: "var(--danger)",
  };
}

/** Masaüstü tablo: küçük dikdörtgen pill */
export function RiskBadgeTable({ level }: { level: RiskLevel }) {
  const { background, borderColor, color } = riskSurface(level);
  const toneClass =
    level === "medium" ? "ds-badge-risk-mid" : level === "very_low" || level === "low" ? "ds-badge-risk-low" : "ds-badge-risk-high";
  return (
    <span
      className={`ds-badge ds-badge--table ${toneClass} inline-flex max-w-full min-w-0 items-center justify-center rounded-[5px] border px-2 py-[3px] text-[9.5px] font-medium leading-none tracking-[-0.015em]`}
      style={{ background, borderColor, color, borderWidth: "1px" }}
    >
      {riskBucketLabel(level)}
    </span>
  );
}

/** Mobil satır: yuvarlak chip (globals .mobile-fund-card__risk ile uyumlu) */
export function RiskBadgeMobile({ level }: { level: RiskLevel }) {
  const cls =
    level === "very_low" || level === "low"
      ? "mobile-fund-card__risk mobile-fund-card__risk--low"
      : level === "medium"
        ? "mobile-fund-card__risk mobile-fund-card__risk--mid"
        : "mobile-fund-card__risk mobile-fund-card__risk--high";
  return <span className={cls}>{riskBucketLabel(level)}</span>;
}

export { riskBucketLabel };

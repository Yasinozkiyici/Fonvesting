import type { ReactNode } from "react";

/** Minimal metrik: etiket + değer (+ isteğe bağlı alt satır). */
export function MetricCard({
  label,
  value,
  hint,
  className = "",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ds-metric-card ${className}`.trim()}>
      <p className="ds-metric-card__label">{label}</p>
      <p className="ds-metric-card__value">{value}</p>
      {hint != null && hint !== "" ? <p className="ds-metric-card__hint">{hint}</p> : null}
    </div>
  );
}

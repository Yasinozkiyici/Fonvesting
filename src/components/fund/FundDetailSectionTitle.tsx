type Props = { children: React.ReactNode; id?: string };

/** Liste / MarketHeader ile uyumlu sakin bölüm başlığı */
export function FundDetailSectionTitle({ children, id }: Props) {
  return (
    <h2
      id={id}
      className="text-[11px] font-semibold uppercase tracking-[0.11em] sm:text-[11.5px]"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </h2>
  );
}

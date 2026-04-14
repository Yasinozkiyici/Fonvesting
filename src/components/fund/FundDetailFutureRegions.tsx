import type { ReactNode } from "react";

type AlternativesProps = {
  children: ReactNode;
};

/**
 * Alternatifler bölgesi: bugün yalnızca benzer fonlar; ileride ek modüller aynı grup içinde aralıklı eklenir.
 */
export function FundDetailAlternativesRegion({ children }: AlternativesProps) {
  return <div className="flex flex-col gap-3 pb-2 sm:gap-4 sm:pb-5">{children}</div>;
}

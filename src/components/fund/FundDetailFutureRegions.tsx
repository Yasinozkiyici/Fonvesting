import type { ReactNode } from "react";

type AlternativesProps = {
  children: ReactNode;
};

/**
 * Alternatifler bölgesi: bugün yalnızca benzer fonlar; ileride ek modüller aynı grup içinde aralıklı eklenir.
 */
export function FundDetailAlternativesRegion({ children }: AlternativesProps) {
  return <div className="flex flex-col gap-4 pb-4 sm:gap-5 sm:pb-8">{children}</div>;
}

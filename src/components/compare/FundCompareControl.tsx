"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Plus } from "@/components/icons";
import {
  addCompareCode,
  COMPARE_CODES_CHANGED_EVENT,
  COMPARE_STORAGE_KEY,
  isInCompareList,
  removeCompareCode,
} from "@/lib/compare-selection";

type Props = {
  code: string;
  /** `card`: mobil liste kartı — minimum dokunma alanı. `table`: masaüstü satırı (kompakt). */
  variant?: "table" | "card";
};

/**
 * Masaüstü satır sonu / mobil kart: kompakt ikon; tabloda satır hover’da belirginleşir, seçiliyken kalır.
 */
export function FundCompareControl({ code, variant = "table" }: Props) {
  const [onList, setOnList] = useState(false);

  const sync = useCallback(() => {
    setOnList(isInCompareList(code));
  }, [code]);

  useEffect(() => {
    sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === COMPARE_STORAGE_KEY) sync();
    };
    const onLocal = () => sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener(COMPARE_CODES_CHANGED_EVENT, onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(COMPARE_CODES_CHANGED_EVENT, onLocal);
    };
  }, [sync]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isInCompareList(code)) {
      removeCompareCode(code);
      setOnList(false);
    } else {
      addCompareCode(code);
      setOnList(true);
    }
  };

  const label = onList ? "Karşılaştırmadan çıkar" : "Karşılaştırmaya ekle";

  const sizeClass =
    variant === "card"
      ? "compare-row-icon--card min-h-[var(--m-tap-min,2.75rem)] min-w-[var(--m-tap-min,2.75rem)] touch-manipulation rounded-[0.65rem]"
      : "compare-row-icon--table h-[1.5rem] w-[1.5rem] rounded-md";

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`compare-row-icon inline-flex shrink-0 items-center justify-center border border-transparent transition-[opacity,background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--card-bg)] ${sizeClass} ${
        onList
          ? "compare-row-icon--on opacity-100"
          : "compare-row-icon--off opacity-[0.46] hover:opacity-[0.88] group-hover:opacity-[0.68] group-hover:border-[var(--border-subtle)] focus-visible:opacity-100"
      }`}
      style={
        onList
          ? {
              borderColor: "color-mix(in srgb, var(--border-subtle) 88%, var(--accent-blue) 12%)",
              background: "color-mix(in srgb, var(--bg-hover) 88%, var(--surface-control))",
              color: "var(--text-secondary)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14)",
            }
          : {
              color: "var(--text-muted)",
              background: "color-mix(in srgb, var(--surface-control) 78%, transparent)",
            }
      }
      title={label}
      aria-label={`${code}: ${label}`}
      aria-pressed={onList}
    >
      {onList ? (
        <Check
          className={variant === "card" ? "h-[15px] w-[15px]" : "h-2.5 w-2.5"}
          strokeWidth={1.6}
          aria-hidden
        />
      ) : (
        <Plus
          className={variant === "card" ? "h-4 w-4" : "h-[13px] w-[13px]"}
          strokeWidth={1.75}
          aria-hidden
        />
      )}
    </button>
  );
}

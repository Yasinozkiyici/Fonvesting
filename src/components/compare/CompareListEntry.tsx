"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  COMPARE_CODES_CHANGED_EVENT,
  COMPARE_STORAGE_KEY,
  readCompareCodes,
} from "@/lib/compare-selection";

/**
 * Ana liste üst çubuğunda: seçim varsa hafif “Karşılaştırma · n” girişi.
 */
export function CompareListEntry() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const sync = () => setCount(readCompareCodes().length);
    sync();
    const onLocal = () => sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === COMPARE_STORAGE_KEY) sync();
    };
    window.addEventListener(COMPARE_CODES_CHANGED_EVENT, onLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(COMPARE_CODES_CHANGED_EVENT, onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  if (count < 1) return null;

  return (
    <Link
      href="/compare"
      prefetch={false}
      className="compare-list-entry shrink-0 rounded-[9px] border px-2 py-[0.32rem] text-[10px] font-semibold tabular-nums tracking-tight transition-[opacity,background-color,border-color,color] hover:opacity-[0.94] sm:text-[10.5px]"
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 90%, var(--text-primary) 8%)",
        color: "var(--text-secondary)",
        background: "color-mix(in srgb, var(--surface-control) 94%, var(--bg-muted))",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16)",
      }}
    >
      Karşılaştırma · {count}
    </Link>
  );
}

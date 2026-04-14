"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  COMPARE_CODES_CHANGED_EVENT,
  COMPARE_STORAGE_KEY,
  clearCompareCodes,
  readCompareCodes,
} from "@/lib/compare-selection";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent-blue)_52%,var(--border-subtle))] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--card-bg)]";

/**
 * Liste üst çubuğunda: seçili kod sayısı — durum göstergesi; ana aksiyon gibi görünmez.
 */
export function CompareListEntry({ className = "" }: { className?: string }) {
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
    <span
      className={`compare-list-entry inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-1 tabular-nums max-md:min-h-[var(--m-tap-min,2.75rem)] max-md:items-stretch max-md:px-2 max-md:py-1.5 md:h-7 md:py-0 ${className}`}
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
        background: "color-mix(in srgb, var(--bg-muted) 18%, var(--card-bg))",
      }}
    >
      <Link
        href="/compare"
        prefetch={false}
        className="inline-flex min-h-0 min-w-0 max-w-[min(100%,14rem)] flex-1 items-center truncate text-[9px] font-medium tracking-tight max-md:min-h-[2.5rem] max-md:px-1 max-md:py-1 touch-manipulation"
        style={{ color: "var(--text-tertiary)" }}
      >
        <span className="md:hidden">Kıyas</span>
        <span className="hidden md:inline">Karşılaştırma</span>{" "}
        <span className="font-semibold tabular-nums" style={{ color: "var(--text-secondary)" }}>
          · {count}
        </span>
      </Link>
      <span className="hidden h-4 w-px shrink-0 self-stretch md:block" style={{ background: "color-mix(in srgb, var(--border-subtle) 55%, transparent)" }} aria-hidden />
      <button
        type="button"
        className={`touch-manipulation shrink-0 self-center text-[9px] font-medium max-md:min-h-[2.5rem] max-md:min-w-[3.25rem] max-md:rounded-md max-md:px-2 md:self-auto ${focusRing}`}
        style={{ color: "var(--text-tertiary)" }}
        onClick={() => clearCompareCodes()}
        aria-label="Karşılaştırma seçimini temizle"
      >
        Kaldır
      </button>
    </span>
  );
}

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
      className={`compare-list-entry inline-flex h-7 max-w-full shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-0 tabular-nums ${className}`}
      style={{
        borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
        background: "color-mix(in srgb, var(--bg-muted) 18%, var(--card-bg))",
      }}
    >
      <Link
        href="/compare"
        prefetch={false}
        className="min-w-0 truncate text-[9px] font-medium tracking-tight"
        style={{ color: "var(--text-tertiary)" }}
      >
        Karşılaştırma{" "}
        <span className="font-semibold tabular-nums" style={{ color: "var(--text-secondary)" }}>
          · {count}
        </span>
      </Link>
      <span className="h-3 w-px shrink-0 self-center" style={{ background: "color-mix(in srgb, var(--border-subtle) 55%, transparent)" }} aria-hidden />
      <button
        type="button"
        className={`shrink-0 text-[9px] font-medium ${focusRing}`}
        style={{ color: "var(--text-tertiary)" }}
        onClick={() => clearCompareCodes()}
        aria-label="Karşılaştırma seçimini temizle"
      >
        Kaldır
      </button>
    </span>
  );
}

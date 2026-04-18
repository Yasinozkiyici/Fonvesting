"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { GitCompareArrows, Share2 } from "@/components/icons";
import {
  addCompareCode,
  COMPARE_CODES_CHANGED_EVENT,
  isInCompareList,
  readCompareCodes,
  removeCompareCode,
} from "@/lib/compare-selection";

type Props = { fundCode: string };

export function FundDetailMobileDock({ fundCode }: Props) {
  const [onList, setOnList] = useState(false);
  const [compareCount, setCompareCount] = useState(0);
  const [shareHint, setShareHint] = useState<string | null>(null);

  const sync = useCallback(() => {
    setOnList(isInCompareList(fundCode));
    setCompareCount(readCompareCodes().length);
  }, [fundCode]);

  useEffect(() => {
    sync();
    const on = () => sync();
    window.addEventListener(COMPARE_CODES_CHANGED_EVENT, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(COMPARE_CODES_CHANGED_EVENT, on);
      window.removeEventListener("storage", on);
    };
  }, [sync]);

  const toggleCompare = () => {
    if (isInCompareList(fundCode)) {
      removeCompareCode(fundCode);
      setOnList(false);
    } else {
      addCompareCode(fundCode);
      setOnList(true);
    }
    setCompareCount(readCompareCodes().length);
  };

  const share = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share && url) {
        await navigator.share({ title: document.title, url });
        setShareHint(null);
        return;
      }
    } catch {
      /* kullanıcı iptal */
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareHint("Bağlantı kopyalandı");
      window.setTimeout(() => setShareHint(null), 2200);
    } catch {
      setShareHint(null);
    }
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[45] border-t px-3 pt-2 md:hidden"
      style={{
        paddingBottom: "max(0.65rem, env(safe-area-inset-bottom, 0px))",
        borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
        background: "color-mix(in srgb, var(--card-bg) 92%, transparent)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        boxShadow: "0 -8px 28px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div className="mx-auto flex max-w-[1320px] items-center gap-2">
        <Link
          href="/compare"
          prefetch={false}
          className="touch-manipulation inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-[0.9rem] border text-[12px] font-semibold"
          style={{
            borderColor: "var(--border-default)",
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
          }}
        >
          <GitCompareArrows className="h-[18px] w-[18px] shrink-0 opacity-80" strokeWidth={2} aria-hidden />
          <span className="truncate">Kıyas ({compareCount})</span>
        </Link>
        <button
          type="button"
          onClick={toggleCompare}
          className="touch-manipulation inline-flex h-12 w-[min(7.5rem,32%)] shrink-0 items-center justify-center rounded-[0.9rem] border text-[12px] font-semibold"
          style={{
            borderColor: onList ? "color-mix(in srgb, var(--accent-blue) 22%, var(--border-subtle))" : "var(--border-default)",
            background: onList ? "color-mix(in srgb, var(--accent-blue) 6%, var(--card-bg))" : "var(--bg-surface)",
            color: "var(--text-primary)",
          }}
          aria-pressed={onList}
        >
          {onList ? "Çıkar" : "Ekle"}
        </button>
        <button
          type="button"
          onClick={() => void share()}
          className="touch-manipulation inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[0.9rem] border"
          style={{
            borderColor: "var(--border-default)",
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
          }}
          aria-label="Paylaş veya bağlantıyı kopyala"
        >
          <Share2 className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        </button>
      </div>
      {shareHint ? (
        <p className="mt-1 text-center text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>
          {shareHint}
        </p>
      ) : null}
    </div>
  );
}

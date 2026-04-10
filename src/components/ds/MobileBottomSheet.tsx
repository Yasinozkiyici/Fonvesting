"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function MobileBottomSheet({ open, title, onClose, children, footer }: Props) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] md:hidden" aria-modal="true" role="dialog" aria-label={title}>
      <button
        type="button"
        aria-label="Kapat"
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(12,22,40,0.42)]"
      />

      <div className="absolute inset-x-0 bottom-0 max-h-[86dvh] overflow-hidden rounded-t-[1.4rem] border-t border-[var(--border-subtle)] bg-[var(--card-bg)] shadow-[0_-10px_30px_rgba(12,22,40,0.16)]">
        <div className="flex items-center justify-between gap-3 border-b px-4 pb-3 pt-3.5" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="min-w-0">
            <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-[color-mix(in_srgb,var(--text-muted)_18%,transparent)]" aria-hidden />
            <h3 className="text-[14px] font-semibold tracking-[-0.02em]" style={{ color: "var(--text-primary)" }}>
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border"
            style={{
              borderColor: "color-mix(in srgb, var(--border-subtle) 86%, transparent)",
              background: "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))",
              color: "var(--text-secondary)",
            }}
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <div
          className="overflow-y-auto px-4 py-4"
          style={{ maxHeight: footer ? "calc(86dvh - 9.5rem)" : "calc(86dvh - 5.8rem)" }}
        >
          {children}
        </div>

        {footer ? (
          <div
            className="border-t px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3"
            style={{ borderColor: "var(--border-subtle)", background: "color-mix(in srgb, var(--card-bg) 98%, var(--bg-muted))" }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

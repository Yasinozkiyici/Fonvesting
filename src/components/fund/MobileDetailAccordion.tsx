"use client";

import { useState } from "react";
import { ChevronDown } from "@/components/icons";

type Props = {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

export function MobileDetailAccordion({ title, hint, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      className="overflow-hidden rounded-[1.05rem] border md:hidden"
      style={{
        borderColor: "var(--border-subtle)",
        background: "var(--card-bg)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex min-h-[3.25rem] w-full items-start justify-between gap-3 px-4 py-3.5 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-[13px] font-semibold tracking-[-0.02em]" style={{ color: "var(--text-primary)" }}>
            {title}
          </p>
          {hint ? (
            <p className="mt-1 text-[11px] leading-snug" style={{ color: "var(--text-secondary)" }}>
              {hint}
            </p>
          ) : null}
        </div>
        <span
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border"
          style={{
            borderColor: "color-mix(in srgb, var(--border-subtle) 86%, transparent)",
            background: "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))",
            color: "var(--text-secondary)",
          }}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
            strokeWidth={2}
          />
        </span>
      </button>

      {open ? (
        <div className="border-t px-4 py-4" style={{ borderColor: "color-mix(in srgb, var(--border-subtle) 84%, transparent)" }}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TABS = [
  { id: "overview", label: "Genel Bakış", selector: '[data-detail-section="overview"]' },
  { id: "performance", label: "Performans", selector: '[data-detail-section="performance"]' },
  { id: "risk", label: "Risk", selector: '[data-detail-section="risk"]' },
  { id: "allocation", label: "Dağılım", selector: '[data-detail-section="allocation"]' },
  { id: "compare", label: "Karşılaştırma", selector: '[data-detail-section="compare"]' },
] as const;

type TabId = (typeof TABS)[number]["id"];

function scrollBehaviorForNav(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "auto";
  if (window.matchMedia("(max-width: 767px)").matches) return "auto";
  return "smooth";
}

type Props = {
  showRiskTab: boolean;
  showCompareTab: boolean;
};

function visibleTabDefs(showRiskTab: boolean, showCompareTab: boolean) {
  return TABS.filter((t) => {
    if (t.id === "risk") return showRiskTab;
    if (t.id === "compare") return showCompareTab;
    return true;
  });
}

export function FundDetailMobileTabNav({ showRiskTab, showCompareTab }: Props) {
  const visibleTabs = useMemo(
    () => visibleTabDefs(showRiskTab, showCompareTab),
    [showCompareTab, showRiskTab]
  );

  const [active, setActive] = useState<TabId>("overview");
  const tablistRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visibleTabs.some((t) => t.id === active)) setActive("overview");
  }, [active, visibleTabs]);

  const scrollToSection = useCallback((id: TabId) => {
    const tab = TABS.find((t) => t.id === id);
    if (!tab) return;
    const list = document.querySelectorAll<HTMLElement>(tab.selector);
    const el = list[0];
    el?.scrollIntoView({ behavior: scrollBehaviorForNav(), block: "start" });
    setActive(id);
  }, []);

  useEffect(() => {
    const tabs = visibleTabDefs(showRiskTab, showCompareTab);
    const elements: HTMLElement[] = [];
    for (const t of tabs) {
      document.querySelectorAll<HTMLElement>(t.selector).forEach((n) => elements.push(n));
    }
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting && e.intersectionRatio > 0.1)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = visible?.target.getAttribute("data-detail-section") as TabId | null;
        if (id && tabs.some((t) => t.id === id)) setActive(id);
      },
      { root: null, rootMargin: "-40% 0px -48% 0px", threshold: [0, 0.08, 0.2] }
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [showCompareTab, showRiskTab]);

  useEffect(() => {
    const el = tablistRef.current?.querySelector<HTMLButtonElement>(`[data-tab-id="${active}"]`);
    el?.scrollIntoView({ behavior: scrollBehaviorForNav(), inline: "center", block: "nearest" });
  }, [active]);

  return (
    <nav
      className="sticky z-[38] border-b md:hidden"
      style={{
        top: "calc(3.375rem + env(safe-area-inset-top, 0px))",
        borderColor: "color-mix(in srgb, var(--border-subtle) 78%, transparent)",
        background: "color-mix(in srgb, var(--card-bg) 86%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
      aria-label="Fon detayı bölümleri"
    >
      <div
        ref={tablistRef}
        className="flex gap-1 overflow-x-auto px-2 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {visibleTabs.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              data-tab-id={tab.id}
              aria-selected={isActive}
              onClick={() => scrollToSection(tab.id)}
              className="touch-manipulation min-h-[2.75rem] shrink-0 rounded-full border px-3 py-2 text-[11px] font-semibold tracking-[-0.02em] transition-[background-color,border-color,color]"
              style={{
                borderColor: isActive ? "color-mix(in srgb, var(--accent-blue) 28%, var(--border-subtle))" : "transparent",
                background: isActive ? "color-mix(in srgb, var(--accent-blue) 7%, var(--card-bg))" : "transparent",
                color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

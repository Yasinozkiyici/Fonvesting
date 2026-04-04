import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

export interface CategoryTabItem {
  href: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  subtitle?: string;
  active: boolean;
}

/**
 * Yatay, kaydırılabilir kategori sekmeleri — mobilde sticky cam şerit.
 */
export function CategoryTabs({
  title,
  items,
  allHref,
  allLabel = "Tümü",
}: {
  title: string;
  items: CategoryTabItem[];
  allHref?: string;
  allLabel?: string;
}) {
  return (
    <section className="category-tabs-sticky">
      <div className="category-tabs-sticky__inner">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="ds-section-label">{title}</h2>
          {allHref ? (
            <Link
              href={allHref}
              className="ds-link-muted hidden shrink-0 items-center gap-1 text-[11px] font-medium tracking-tight sm:inline-flex"
            >
              {allLabel}
              <ArrowRight className="h-3 w-3" strokeWidth={2} aria-hidden />
            </Link>
          ) : null}
        </div>
        <div className="category-tabs-scroll -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 pt-0.5 sm:-mx-0 sm:px-0">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              scroll={false}
              data-active={item.active ? "true" : "false"}
              className="category-tab-pill shrink-0"
            >
              {item.icon ? <span className="category-tab-pill__icon">{item.icon}</span> : null}
              <span className="category-tab-pill__main">
                <span className="category-tab-pill__label">{item.label}</span>
                {item.count != null ? (
                  <span className="category-tab-pill__count tabular-nums">
                    {Number.isFinite(item.count) ? item.count.toLocaleString("tr-TR") : "—"}
                  </span>
                ) : null}
              </span>
              {item.subtitle ? <span className="category-tab-pill__sub">{item.subtitle}</span> : null}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

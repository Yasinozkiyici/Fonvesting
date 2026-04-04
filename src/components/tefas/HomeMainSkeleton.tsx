import { Fragment } from "react";

/** Ana sayfa: piyasa özeti + kategori şeridi iskeleti (Suspense / loading.tsx). */
export default function HomeMainSkeleton() {
  return (
    <section className="space-y-3 sm:space-y-4">
      <div className="hero-section">
        <div className="hero-product__intro space-y-2.5">
          <div className="skeleton h-2.5 w-36 rounded-full" />
          <div className="skeleton h-8 w-[min(100%,20rem)] rounded-md" />
          <div className="skeleton h-4 w-full max-w-lg rounded-md" />
          <div className="skeleton h-4 w-4/5 max-w-md rounded-md" />
        </div>
        <div className="hero-metrics-panel" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <Fragment key={i}>
              {i > 0 ? <span className="hero-metric-sep" /> : null}
              <div className="hero-metric-cell">
                <div className="flex gap-3 sm:gap-3.5">
                  <div className="skeleton mt-0.5 h-[18px] w-[18px] shrink-0 rounded-sm opacity-80" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="skeleton h-2 w-20 rounded-full opacity-70" />
                    <div className="skeleton h-7 w-[min(100%,7.5rem)] rounded-md" />
                    <div className="skeleton h-3 w-[min(100%,9rem)] rounded-full opacity-60" />
                  </div>
                </div>
              </div>
            </Fragment>
          ))}
        </div>
      </div>
      <div className="category-rail-section px-0 pb-0 pt-2 sm:pt-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2 sm:mb-2">
          <div className="skeleton h-3 w-36 rounded-full opacity-80" />
          <div className="skeleton h-3 w-10 rounded-full opacity-60" />
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 sm:grid-cols-3 sm:gap-x-2.5 xl:grid-cols-6">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="flex min-h-[36px] items-start gap-2 rounded-md border-l-2 border-l-transparent py-1 pl-2 pr-1 sm:min-h-[38px]"
            >
              <div className="skeleton mt-0.5 h-3 w-3 shrink-0 rounded-sm opacity-70" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="skeleton h-2.5 w-16 rounded-full opacity-75" />
                  <div className="skeleton h-2.5 w-7 shrink-0 rounded-full opacity-55" />
                </div>
                <div className="skeleton h-2 w-20 rounded-full opacity-45" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

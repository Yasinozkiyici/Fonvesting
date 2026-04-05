import { Fragment } from "react";

/** Ana sayfa: kompakt hero + kategori ızgarası iskeleti. */
export default function HomeMainSkeleton() {
  return (
    <section className="space-y-3 sm:space-y-4">
      <div className="ds-hero-compact">
        <div className="ds-hero-compact__intro space-y-2">
          <div className="skeleton h-2.5 w-32 rounded-full" />
          <div className="skeleton h-7 w-[min(100%,16rem)] rounded-md" />
          <div className="skeleton h-10 w-full max-w-2xl rounded-lg" />
        </div>
        <div className="ds-hero-stats market-snapshot-bar mt-3 flex animate-pulse items-stretch">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Fragment key={i}>
              <div className="flex min-w-[4.25rem] flex-col justify-center gap-1.5 px-2 sm:px-3">
                <div className="skeleton h-2 w-9 rounded-full opacity-60" />
                <div className="skeleton h-[18px] w-[3.25rem] rounded-md opacity-80" />
              </div>
              {i < 5 ? <span className="market-snapshot-sep" aria-hidden /> : null}
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
              className="flex min-h-[36px] items-start gap-2 rounded-md border-l-[1.5px] border-l-transparent py-1 pl-2 pr-1 sm:min-h-[38px]"
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

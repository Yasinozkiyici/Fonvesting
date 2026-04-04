/** Ana sayfa: kompakt hero + sticky kategori iskeleti. */
export default function HomeMainSkeleton() {
  return (
    <section className="space-y-3">
      <div className="ds-hero-compact">
        <div className="ds-hero-compact__intro space-y-2">
          <div className="skeleton h-2.5 w-32 rounded-full" />
          <div className="skeleton h-7 w-[min(100%,16rem)] rounded-md" />
          <div className="skeleton h-10 w-full max-w-2xl rounded-lg" />
        </div>
      </div>
      <div className="category-tabs-sticky">
        <div className="skeleton mb-2 h-3 w-40 rounded-full" />
        <div className="flex gap-2 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="skeleton h-14 w-[5.5rem] shrink-0 rounded-[10px]" />
          ))}
        </div>
      </div>
    </section>
  );
}

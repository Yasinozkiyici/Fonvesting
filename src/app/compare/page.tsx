import Header from "@/components/Header";
import { SitePageShell } from "@/components/SitePageShell";
import Footer from "@/components/tefas/Footer";
import { ComparePageClient } from "@/components/compare/ComparePageClient";
import { LIVE_DATA_PAGE_REVALIDATE_SEC } from "@/lib/data-freshness";

export const revalidate = LIVE_DATA_PAGE_REVALIDATE_SEC;

export default function ComparePage() {
  return (
    <SitePageShell>
        <Header />

        <main className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-1 flex-col px-3 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-10">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
            Karşılaştır
          </p>
          <h1 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl" style={{ color: "var(--text-primary)" }}>
            Seçtiğiniz fonlar
          </h1>
          <p className="mt-2 max-w-xl text-[13px] leading-snug sm:text-sm" style={{ color: "var(--text-secondary)" }}>
            En fazla dört fonu aynı çizgide okuyun; üstte kısa karar özeti, altta kompakt kıyas tablosu görünür. Referans ve dönem seçimi mevcut compare akışını korur.
          </p>
          <div className="mt-6 min-w-0">
            <ComparePageClient />
          </div>
        </main>

        <Footer />
    </SitePageShell>
  );
}

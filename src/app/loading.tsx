import Header from "@/components/Header";
import Footer from "@/components/tefas/Footer";
import HomeMainSkeleton from "@/components/tefas/HomeMainSkeleton";

/** Ana route veri çekerken tam sayfa kabuk + iskelet (layout’taki genel Suspense kaldırıldı). */
export default function AppLoading() {
  return (
    <div className="relative isolate flex min-h-screen flex-col">
      <div className="gradient-mesh" aria-hidden>
        <div className="mesh-layer-1" />
        <div className="mesh-layer-2" />
        <div className="mesh-layer-3" />
        <div className="noise" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
        <Header />

        <main className="mx-auto w-full max-w-[1320px] flex-1 px-3 py-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:px-6 sm:py-7 sm:pb-8 lg:px-8">
          <HomeMainSkeleton />

          <div id="funds-table" className="mt-5 sm:mt-6">
            <div
              className="rounded-xl border p-4 text-sm"
              style={{ borderColor: "var(--border-default)", color: "var(--text-muted)" }}
            >
              Tablo yükleniyor…
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import { SitePageShell } from "@/components/SitePageShell";
import Footer from "@/components/tefas/Footer";
import { FundDetailHero } from "@/components/fund/FundDetailHero";
import { FundDetailChart } from "@/components/fund/FundDetailChart";
import { FundDetailProfile } from "@/components/fund/FundDetailProfile";
import { FundDetailRisk } from "@/components/fund/FundDetailRisk";
import { FundDetailSimilar } from "@/components/fund/FundDetailSimilar";
import { FundDetailAlternativesRegion } from "@/components/fund/FundDetailFutureRegions";
import { LIVE_DATA_PAGE_REVALIDATE_SEC } from "@/lib/data-freshness";
import { FUND_DETAIL_PHASE2_IDS } from "@/lib/fund-detail-layout";
import { loadFundDetailPageData } from "@/lib/services/fund-detail-load";
import { fundDisplaySubtitle } from "@/lib/fund-list-format";

const FundDetailTrends = dynamic(
  () => import("@/components/fund/FundDetailTrends").then((mod) => mod.FundDetailTrends),
  {
    loading: () => (
      <div
        className="rounded-[1.05rem] border px-4 py-4 sm:px-5 sm:py-5"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--card-bg)",
          boxShadow: "var(--shadow-xs)",
        }}
      >
        <div className="h-4 w-32 animate-pulse rounded" style={{ background: "var(--bg-muted)" }} />
        <div className="mt-2 h-3 w-48 animate-pulse rounded" style={{ background: "var(--bg-muted)" }} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="h-44 animate-pulse rounded-[0.95rem]" style={{ background: "var(--bg-muted)" }} />
          <div className="h-44 animate-pulse rounded-[0.95rem]" style={{ background: "var(--bg-muted)" }} />
        </div>
      </div>
    ),
  }
);

export const revalidate = LIVE_DATA_PAGE_REVALIDATE_SEC;

type Props = { params: { code: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const raw = decodeURIComponent(params.code ?? "").trim();
  if (!raw) return { title: "Fon — Yatirim.io" };
  const data = await loadFundDetailPageData(raw);
  if (!data) return { title: "Fon bulunamadı — Yatirim.io" };
  const subtitle = fundDisplaySubtitle(data.fund);
  return {
    title: `${data.fund.code} — ${subtitle} — Yatirim.io`,
    description: `${data.fund.name}: güncel fiyat, performans grafiği ve fon profili.`,
  };
}

export default async function FundDetailPage({ params }: Props) {
  const code = decodeURIComponent(params.code ?? "").trim();
  if (!code) notFound();

  const data = await loadFundDetailPageData(code);
  if (!data) notFound();

  return (
    <SitePageShell>
      <Header />

      <main className="mx-auto w-full max-w-[1320px] flex-1 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:px-6 sm:py-5.5 sm:pb-7 lg:px-8">
        <FundDetailHero data={data} />

        <div className="mt-4 flex flex-col gap-4.5 sm:mt-5 sm:gap-5">
          <FundDetailChart data={data} />

          <div style={{ contentVisibility: "auto", containIntrinsicSize: "232px" }}>
            <FundDetailRisk data={data} />
          </div>

          <div style={{ contentVisibility: "auto", containIntrinsicSize: "400px" }}>
            <FundDetailTrends data={data} />
          </div>

          <div style={{ contentVisibility: "auto", containIntrinsicSize: "360px" }}>
            <FundDetailProfile data={data} />
          </div>

          <div style={{ contentVisibility: "auto", containIntrinsicSize: "320px" }}>
            <FundDetailAlternativesRegion>
              <FundDetailSimilar
                sectionId={FUND_DETAIL_PHASE2_IDS.alternatives}
                funds={data.similarFunds}
                categoryName={data.fund.category?.name ?? null}
              />
            </FundDetailAlternativesRegion>
          </div>
        </div>
      </main>

      <Footer />
    </SitePageShell>
  );
}

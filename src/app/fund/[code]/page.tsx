import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/tefas/Footer";
import { FundDetailHero } from "@/components/fund/FundDetailHero";
import { FundDetailChart } from "@/components/fund/FundDetailChart";
import { FundDetailProfile } from "@/components/fund/FundDetailProfile";
import { FundDetailRisk } from "@/components/fund/FundDetailRisk";
import { FundDetailActions } from "@/components/fund/FundDetailActions";
import { FundDetailSimilar } from "@/components/fund/FundDetailSimilar";
import { loadFundDetailPageData } from "@/lib/services/fund-detail-load";
import { fundDisplaySubtitle } from "@/lib/fund-list-format";

export const revalidate = 3600;

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
    <div className="relative isolate flex min-h-screen flex-col">
      <div className="relative z-10 flex min-h-screen flex-col">
        <Header />

        <main className="mx-auto w-full max-w-[1320px] flex-1 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:px-6 sm:py-6 sm:pb-7 lg:px-8">
          <FundDetailHero data={data} />
          <div className="flex flex-col gap-10 sm:gap-12">
            <FundDetailChart series={data.priceSeries} />
            <FundDetailProfile data={data} />
            <FundDetailRisk data={data} />
            <FundDetailActions fundCode={data.fund.code} />
            <FundDetailSimilar funds={data.similarFunds} categoryName={data.fund.category?.name ?? null} />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

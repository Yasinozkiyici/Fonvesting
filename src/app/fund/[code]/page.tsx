import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import { SitePageShell } from "@/components/SitePageShell";
import Footer from "@/components/tefas/Footer";
import { FundDetailHero } from "@/components/fund/FundDetailHero";
import { FundDetailAutoRecover } from "@/components/fund/FundDetailAutoRecover";
import { FundDetailMobileDock } from "@/components/fund/FundDetailMobileDock";
import { FundDetailMobileTabNav } from "@/components/fund/FundDetailMobileTabNav";
import { FundDetailProfile } from "@/components/fund/FundDetailProfile";
import { FundDetailRisk, fundDetailRiskSectionHasContent } from "@/components/fund/FundDetailRisk";
import { FundDetailSimilar } from "@/components/fund/FundDetailSimilar";
import { FundDetailStabilityProbe } from "@/components/fund/FundDetailStabilityProbe";
import { FundDetailAlternativesRegion } from "@/components/fund/FundDetailFutureRegions";
import { LIVE_DATA_PAGE_REVALIDATE_SEC } from "@/lib/data-freshness";
import { FUND_DETAIL_PHASE2_IDS } from "@/lib/fund-detail-layout";
import {
  deriveFundDetailBehaviorContract,
  deriveFundDetailSectionStates,
  shouldRenderSectionFromContract,
} from "@/lib/fund-detail-section-status";
import { normalizeFundDetailPayloadAtBoundary } from "@/lib/data-flow/detail-boundary";
import { logDetailDataFlowEvidence } from "@/lib/data-flow/diagnostics";
import { loadFundDetailPageData } from "@/lib/services/fund-detail-load";

function FundDetailChartSkeleton() {
  return (
    <div
      aria-hidden
      className="rounded-[1.05rem] border px-3 py-3 sm:px-5 sm:py-4"
      style={{
        minHeight: 300,
        borderColor: "var(--border-subtle)",
        background: "var(--card-bg)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      <div className="h-4 w-40 rounded-md" style={{ background: "var(--bg-muted)" }} />
      <div className="mt-3 h-4 max-w-[14rem] rounded-md opacity-90" style={{ background: "var(--bg-muted)" }} />
      <div className="mt-4 h-48 w-full rounded-[0.9rem] opacity-80" style={{ background: "var(--bg-muted)" }} />
      <div className="mt-3 h-20 w-full rounded-[0.72rem] opacity-70" style={{ background: "var(--bg-muted)" }} />
    </div>
  );
}

const FundDetailChart = dynamic(
  () => import("@/components/fund/FundDetailChart").then((mod) => mod.FundDetailChart),
  {
    ssr: true,
    loading: () => <FundDetailChartSkeleton />,
  }
);

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
        <div className="h-4 w-32 rounded" style={{ background: "var(--bg-muted)", opacity: 0.9 }} />
        <div className="mt-2 h-3 w-48 rounded" style={{ background: "var(--bg-muted)", opacity: 0.85 }} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="h-44 rounded-[0.95rem]" style={{ background: "var(--bg-muted)", opacity: 0.75 }} />
          <div className="h-44 rounded-[0.95rem]" style={{ background: "var(--bg-muted)", opacity: 0.75 }} />
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
  const code = raw.toUpperCase();
  return {
    title: `${code} — Fon Detayı — Yatirim.io`,
    description: `${code}: güncel fiyat, performans grafiği ve fon profili.`,
  };
}

export default async function FundDetailPage({ params }: Props) {
  const code = decodeURIComponent(params.code ?? "").trim();
  if (!code) notFound();

  const data = await loadFundDetailPageData(code);
  if (!data) notFound();
  const boundary = normalizeFundDetailPayloadAtBoundary(data);
  logDetailDataFlowEvidence({
    code: code.toUpperCase(),
    surfaceState: boundary.surfaceState.kind,
    rejectedRows: boundary.diagnostics.rejectedRows,
    normalizedRows: boundary.diagnostics.normalizedRows,
    rejectedReason: boundary.diagnostics.rejectedReason,
  });
  if (!boundary.payload) {
    return (
      <SitePageShell>
        <Header />
        <main className="mx-auto w-full min-w-0 max-w-[1320px] flex-1 overflow-x-clip overscroll-x-none px-3 py-4 sm:px-6 sm:py-5 lg:px-8">
          <div
            className="rounded-[1rem] border px-4 py-4 text-sm"
            style={{
              borderColor: "var(--border-subtle)",
              background: "var(--card-bg)",
              color: "var(--text-secondary)",
            }}
            data-detail-surface-state={boundary.surfaceState.kind}
          >
            Fon detayı şu an güvenli şekilde oluşturulamadı. Lütfen kısa süre sonra tekrar deneyin.
          </div>
        </main>
        <Footer variant="detail" />
      </SitePageShell>
    );
  }
  const safeData = boundary.payload;
  const selfCode = safeData.fund.code.trim().toUpperCase();
  const alternativesRenderableCount = safeData.similarFunds.filter((item) => {
    const altCode = item.code?.trim().toUpperCase();
    return Boolean(altCode && altCode !== selfCode);
  }).length;
  const sectionStates = deriveFundDetailSectionStates(safeData);
  const behavior = deriveFundDetailBehaviorContract(safeData);
  const alternativesHasRenderablePayload = alternativesRenderableCount > 0;
  const shouldRenderAlternativesSection = shouldRenderSectionFromContract(
    behavior.canRenderAlternatives,
    alternativesHasRenderablePayload
  );

  const showRiskTab = fundDetailRiskSectionHasContent(data);
  const showCompareTab = shouldRenderAlternativesSection;

  return (
    <SitePageShell>
      <Header />

      <main className="mx-auto w-full min-w-0 max-w-[1320px] flex-1 overflow-x-clip overscroll-x-none px-3 py-4 pb-20 max-md:pb-[max(6.75rem,calc(5.25rem+env(safe-area-inset-bottom,0px)))] sm:px-6 sm:py-5 md:pb-9 lg:px-8 lg:pb-10">
        <div
          className="sr-only"
          data-detail-overall-health={safeData.overallDetailHealth?.overallDetailHealth ?? "unknown"}
          data-detail-reliability-class={safeData.overallDetailHealth?.reliabilityClass ?? safeData.degraded?.reliabilityClass ?? "unknown"}
          data-detail-trust-final={safeData.overallDetailHealth?.trustAsFinal ? "1" : "0"}
          data-detail-surface-state={boundary.surfaceState.kind}
        />
        <FundDetailAutoRecover
          fundCode={safeData.fund.code}
          degraded={Boolean(safeData.degraded?.active)}
          sectionStates={sectionStates}
          suppressAutoRefresh={
            behavior.tier === "LOW_DATA" ||
            behavior.tier === "NO_USEFUL_DATA" ||
            safeData.overallDetailHealth?.overallDetailHealth === "invalid"
          }
        />
        <FundDetailStabilityProbe fundCode={safeData.fund.code} />
        <FundDetailHero data={safeData} />

        <FundDetailMobileTabNav showRiskTab={showRiskTab} showCompareTab={showCompareTab} />

        <div className="mt-3 flex flex-col gap-4 sm:mt-5 sm:gap-6 md:mt-5">
          <div
            data-detail-section="performance"
            className="flex flex-col gap-4 max-md:scroll-mt-[calc(3.375rem+3.25rem+env(safe-area-inset-top,0px))] md:gap-6"
          >
            <FundDetailChart data={safeData} />
            <FundDetailTrends data={safeData} />
          </div>

          <div style={{ contentVisibility: "auto", containIntrinsicSize: "232px" }}>
            <FundDetailRisk data={safeData} />
          </div>

          <div style={{ contentVisibility: "auto", containIntrinsicSize: "360px" }}>
            <FundDetailProfile data={safeData} />
          </div>

          {shouldRenderAlternativesSection ? (
            <div style={{ contentVisibility: "auto", containIntrinsicSize: "320px" }}>
              <FundDetailAlternativesRegion>
                <FundDetailSimilar
                  sectionId={FUND_DETAIL_PHASE2_IDS.alternatives}
                  funds={safeData.similarFunds}
                  categoryName={safeData.fund.category?.name ?? null}
                />
              </FundDetailAlternativesRegion>
            </div>
          ) : null}
        </div>
      </main>

      <FundDetailMobileDock fundCode={safeData.fund.code} />

      <Footer variant="detail" />
    </SitePageShell>
  );
}

import { prisma } from "@/lib/prisma";

type LatestDates = {
  fund: string | null;
  gold: string | null;
  usdtry: string | null;
  interest: string | null;
  metricsUpdatedAt: string | null;
};

async function latestMacroDateByCode(code: string): Promise<string | null> {
  try {
    const row = await prisma.macroObservation.findFirst({
      where: { series: { code } },
      orderBy: { date: "desc" },
      select: { date: true },
    });
    return row?.date.toISOString() ?? null;
  } catch {
    return null;
  }
}

export async function readDailyPipelineLatestDates(): Promise<LatestDates> {
  let fund: { date: Date } | null = null;
  let metrics: { updatedAt: Date } | null = null;
  try {
    fund = await prisma.fundPriceHistory.findFirst({ orderBy: { date: "desc" }, select: { date: true } });
  } catch {
    fund = null;
  }
  try {
    metrics = await prisma.fundDerivedMetrics.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
  } catch {
    metrics = null;
  }
  const gold = await latestMacroDateByCode("GOLD_TRY_GRAM");
  const usdtry = await latestMacroDateByCode("USDTRY");
  const interest = await latestMacroDateByCode("TCMB_POLICY_RATE");

  return {
    fund: fund?.date.toISOString() ?? null,
    gold,
    usdtry,
    interest,
    metricsUpdatedAt: metrics?.updatedAt.toISOString() ?? null,
  };
}

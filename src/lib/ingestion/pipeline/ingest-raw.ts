import { RawPayloadParseStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pipelineLog } from "@/lib/ingestion/logging/pipeline-log";
import type { RawInsertPlan } from "@/lib/ingestion/types";

type RawTable = "market" | "fundMetadata" | "investorCounts" | "prices" | "portfolioBreakdowns";

async function findFirstChecksum(table: RawTable, checksum: string) {
  switch (table) {
    case "market":
      return prisma.rawMarketPayload.findFirst({ where: { checksum }, select: { id: true } });
    case "fundMetadata":
      return prisma.rawFundMetadataPayload.findFirst({ where: { checksum }, select: { id: true } });
    case "investorCounts":
      return prisma.rawInvestorCountsPayload.findFirst({ where: { checksum }, select: { id: true } });
    case "prices":
      return prisma.rawPricesPayload.findFirst({ where: { checksum }, select: { id: true } });
    case "portfolioBreakdowns":
      return prisma.rawPortfolioBreakdownsPayload.findFirst({ where: { checksum }, select: { id: true } });
    default:
      throw new Error("unknown_raw_table");
  }
}

async function createRow(table: RawTable, plan: RawInsertPlan) {
  const data = {
    source: plan.source,
    sourceKey: plan.sourceKey,
    effectiveDate: plan.effectiveDate,
    payload: plan.payload as object,
    checksum: plan.checksum,
    parseStatus: plan.parseStatus ?? RawPayloadParseStatus.PENDING,
    parseError: plan.parseError ?? null,
  };
  switch (table) {
    case "market":
      return prisma.rawMarketPayload.create({ data });
    case "fundMetadata":
      return prisma.rawFundMetadataPayload.create({ data });
    case "investorCounts":
      return prisma.rawInvestorCountsPayload.create({ data });
    case "prices":
      return prisma.rawPricesPayload.create({ data });
    case "portfolioBreakdowns":
      return prisma.rawPortfolioBreakdownsPayload.create({ data });
    default:
      throw new Error("unknown_raw_table");
  }
}

/**
 * Hash tabanlı dedup: aynı checksum varsa insert atlanır (idempotent).
 */
export async function ingestRawRows(table: RawTable, plans: RawInsertPlan[]): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const plan of plans) {
    const existing = await findFirstChecksum(table, plan.checksum);
    if (existing) {
      skipped += 1;
      continue;
    }
    await createRow(table, plan);
    inserted += 1;
  }

  pipelineLog({
    level: "info",
    phase: "ingestion",
    step: "ingest_raw",
    message: "batch_complete",
    data: { table, inserted, skipped, total: plans.length },
  });

  return { inserted, skipped };
}

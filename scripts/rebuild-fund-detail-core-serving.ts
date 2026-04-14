import "./load-env";
import { prisma } from "../src/lib/prisma";
import { promises as fs } from "node:fs";
import path from "node:path";
import { rebuildFundDetailCoreServingCache } from "../src/lib/services/fund-detail-core-serving.service";

async function readLatestSnapshotDateFromDb(): Promise<Date | undefined> {
  const latest = await prisma.fundDailySnapshot.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return latest?.date ?? undefined;
}

async function resolveSourceDateHint(): Promise<Date | undefined> {
  const rawFromEnv = process.env.FUND_DETAIL_CORE_REBUILD_SOURCE_DATE?.trim();
  if (rawFromEnv) {
    const parsed = new Date(rawFromEnv);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  const latestFromDb = await readLatestSnapshotDateFromDb();
  if (latestFromDb) return latestFromDb;
  const filePath =
    process.env.FUND_DETAIL_CORE_SERVING_FILE_PATH?.trim() ||
    path.join(process.cwd(), ".cache", "fund-detail-core-serving.v1.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { snapshotDate?: unknown };
    if (typeof parsed.snapshotDate !== "string") return undefined;
    const date = new Date(parsed.snapshotDate);
    return Number.isFinite(date.getTime()) ? date : undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  const sourceDate = await resolveSourceDateHint();
  const result = await rebuildFundDetailCoreServingCache({ sourceDate });
  console.log(JSON.stringify(result, null, 2));
  const finalStatus = result.fullyCompleted ? "ok" : "partial_fail";
  console.info(
    `[rebuild-fund-detail-core-serving] status=${finalStatus} mode=${result.rebuildMode} ` +
      `processed=${result.processedFunds} succeeded=${result.succeededFunds} failed=${result.failedFunds} ` +
      `skipped=${result.skippedFunds} writtenThisRun=${result.writtenThisRun} writtenRecords=${result.writtenRecords} ` +
      `universe=${result.universeFundsTotal} candidateFunds=${result.candidateFunds} ` +
      `partialMerge=${result.partialMerge ? 1 : 0} replacedArtifact=${result.replacedArtifact ? 1 : 0} ` +
      `mergedFromExisting=${result.mergedFromExistingRecords} checkpointFlushes=${result.checkpointFlushes} ` +
      `retries=${result.retries} failed_chunks=${result.failedChunks} ` +
      `timeouts={pool:${result.timeoutStats.poolCheckoutTimeout},stmt:${result.timeoutStats.statementTimeout},` +
      `tx:${result.timeoutStats.transactionTimeout},conn:${result.timeoutStats.connectionClosed}} ` +
      `elapsed_ms=${result.elapsedMs} written=${result.written} snapshot_date=${result.snapshotDate ?? "none"}`
  );
  if (!result.fullyCompleted) {
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    console.error("[rebuild-fund-detail-core-serving] failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

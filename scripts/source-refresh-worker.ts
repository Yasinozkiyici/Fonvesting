import "./load-env";
import { runDailyMaintenance } from "../src/lib/services/daily-maintenance.service";

function readNumberArg(flag: string): number | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  const raw = process.argv[index + 1];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function main() {
  const overlapDays = readNumberArg("--overlap-days") ?? 10;
  const staleMinutes = readNumberArg("--stale-minutes") ?? 60;

  const startedAt = new Date();
  console.info("[source-refresh-worker] started", {
    startedAt: startedAt.toISOString(),
    overlapDays,
    staleMinutes,
  });

  const result = await runDailyMaintenance({
    overlapDays,
    staleMinutes,
  });

  console.info("[source-refresh-worker] source", {
    historyOk: result.source.history.ok,
    historyWrittenRows: result.source.history.writtenRows,
    historyTouchedDates: result.source.history.touchedDates,
    macroOk: result.source.macro.ok,
    macroPartial: result.source.macro.partial,
    macroWrittenRows: result.source.macro.writtenRows,
  });

  console.info("[source-refresh-worker] serving", {
    snapshotDate: result.serving.snapshotDate,
    servingWritten: result.serving.serving.written,
    derivedWritten: result.serving.derived.written,
    cacheWarmWritten: result.serving.warm.written,
  });

  const ok = result.source.history.ok && result.source.macro.ok;
  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[source-refresh-worker] failed", error);
  process.exit(1);
});

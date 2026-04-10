import { runDailyMaintenance } from "@/lib/services/daily-maintenance.service";

export async function runDailyPipeline() {
  // Existing maintenance flow already:
  // - appends latest fund history rows (no historical overwrite),
  // - appends macro rows (gold, USDTRY, rates) incrementally,
  // - rebuilds serving snapshots/derived metrics,
  // - warms UI score caches.
  return runDailyMaintenance();
}

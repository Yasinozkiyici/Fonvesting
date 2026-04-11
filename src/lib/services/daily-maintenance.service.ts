import { runDailySourceRefresh } from "@/lib/services/daily-source-refresh.service";
import { runServingDailyIncremental } from "@/lib/services/serving-rebuild.service";

export type DailyMaintenanceResult = {
  source: Awaited<ReturnType<typeof runDailySourceRefresh>>;
  serving: Awaited<ReturnType<typeof runServingDailyIncremental>>;
};

export async function runDailyMaintenance(options?: {
  overlapDays?: number;
  staleMinutes?: number;
}): Promise<DailyMaintenanceResult> {
  const source = await runDailySourceRefresh(options);
  const serving = await runServingDailyIncremental({ warmCaches: false });
  return { source, serving };
}

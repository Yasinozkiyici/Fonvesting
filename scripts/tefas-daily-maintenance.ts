import "./load-env";
import { runDailyMaintenance } from "../src/lib/services/daily-maintenance.service";

async function main() {
  const overlapDaysRaw = process.argv.includes("--overlap-days")
    ? process.argv[process.argv.indexOf("--overlap-days") + 1]
    : null;
  const staleMinutesRaw = process.argv.includes("--stale-minutes")
    ? process.argv[process.argv.indexOf("--stale-minutes") + 1]
    : null;

  const overlapDays = overlapDaysRaw ? Number(overlapDaysRaw) : 7;
  const staleMinutes = staleMinutesRaw ? Number(staleMinutesRaw) : 120;

  const result = await runDailyMaintenance({
    overlapDays: Number.isFinite(overlapDays) ? overlapDays : 7,
    staleMinutes: Number.isFinite(staleMinutes) ? staleMinutes : 120,
  });

  console.log(JSON.stringify(result, null, 2));

  process.exit(result.source.history.ok && result.source.macro.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

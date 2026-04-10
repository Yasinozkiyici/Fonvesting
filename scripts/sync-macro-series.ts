import "./load-env";
import {
  appendRecentMacroSeries,
  recoverStaleMacroSyncState,
  syncMacroSeriesRange,
} from "../src/lib/services/macro-series.service";
import { startOfUtcDay } from "../src/lib/trading-calendar-tr";

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function parseDateArg(raw: string): Date {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    return new Date(Date.UTC(year as number, (month as number) - 1, day as number, 0, 0, 0, 0));
  }
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(trimmed)) {
    const [day, month, year] = trimmed.split(".").map(Number);
    return new Date(Date.UTC(year as number, (month as number) - 1, day as number, 0, 0, 0, 0));
  }
  throw new Error(`Geçersiz tarih argümanı: ${raw}`);
}

async function main() {
  const append = process.argv.includes("--append");
  const daysRaw = readArg("--days");
  const fromRaw = readArg("--from");
  const toRaw = readArg("--to");
  const staleMinutesRaw = readArg("--stale-minutes");
  const dailyOverlapRaw = readArg("--daily-overlap-days");
  const monthlyOverlapRaw = readArg("--monthly-overlap-days");

  const staleMinutes = staleMinutesRaw ? Number(staleMinutesRaw) : 120;
  const dailyOverlapDays = dailyOverlapRaw ? Number(dailyOverlapRaw) : 14;
  const monthlyOverlapDays = monthlyOverlapRaw ? Number(monthlyOverlapRaw) : 62;

  const recovery = await recoverStaleMacroSyncState(Number.isFinite(staleMinutes) ? staleMinutes : 120);

  let result;
  if (append) {
    result = await appendRecentMacroSeries(
      Number.isFinite(dailyOverlapDays) ? dailyOverlapDays : 14,
      Number.isFinite(monthlyOverlapDays) ? monthlyOverlapDays : 62
    );
  } else if (fromRaw && toRaw) {
    result = await syncMacroSeriesRange({
      startDate: parseDateArg(fromRaw),
      endDate: parseDateArg(toRaw),
    });
  } else {
    const days = daysRaw ? Number(daysRaw) : 730;
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error("--days pozitif sayı olmalı.");
    }
    const endDate = startOfUtcDay(new Date());
    result = await syncMacroSeriesRange({
      startDate: new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000),
      endDate,
    });
  }

  console.log(
    JSON.stringify(
      {
        recovery,
        macro: result,
      },
      null,
      2
    )
  );

  process.exit(result.ok || result.partial ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

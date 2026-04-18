import { fetchSupabaseRestJson, hasSupabaseRestConfig } from "@/lib/supabase-rest";

async function main() {
  if (!hasSupabaseRestConfig()) {
    console.log("no_supabase_rest_config");
    return;
  }
  const series = await fetchSupabaseRestJson<Array<{ id: string; code: string; isActive?: boolean }>>(
    "MacroSeries?select=id,code,isActive&order=code.asc&limit=200",
    { revalidate: 1 }
  );
  console.log("series_count", series.length);
  console.log("series_codes", series.map((s) => s.code).join(","));
  const ids = series.map((s) => s.id);
  if (ids.length === 0) return;
  const obs = await fetchSupabaseRestJson<Array<{ seriesId: string; date: string; value: number }>>(
    `MacroObservation?select=seriesId,date,value&seriesId=in.(${ids.join(",")})&order=date.desc&limit=1000`,
    { revalidate: 1 }
  );
  const bySeries = new Map<string, { count: number; latest: string | null }>();
  for (const s of series) bySeries.set(s.id, { count: 0, latest: null });
  for (const o of obs) {
    const cur = bySeries.get(o.seriesId);
    if (!cur) continue;
    cur.count += 1;
    if (!cur.latest) cur.latest = o.date;
  }
  const summary = series.map((s) => ({ code: s.code, count: bySeries.get(s.id)?.count ?? 0, latest: bySeries.get(s.id)?.latest ?? null }));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

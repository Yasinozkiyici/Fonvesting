import { getEffectiveDatabaseUrl, prisma } from "@/lib/prisma";

export type DiagnosticsSnapshot = {
  fundCount: number;
  err: string | null;
  dbUrlPreview: string;
  effectiveDbUrlPreview: string;
};

export async function getDiagnosticsSnapshot(): Promise<DiagnosticsSnapshot> {
  let fundCount = 0;
  let err: string | null = null;
  try {
    fundCount = await prisma.fund.count();
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const raw = process.env.DATABASE_URL ?? "(tanımsız)";
  let effective = "";
  try {
    effective = getEffectiveDatabaseUrl();
  } catch {
    effective = "(çözülemedi)";
  }
  return {
    fundCount,
    err,
    dbUrlPreview: raw.slice(0, 64) + (raw.length > 64 ? "…" : ""),
    effectiveDbUrlPreview: effective.slice(0, 80) + (effective.length > 80 ? "…" : ""),
  };
}

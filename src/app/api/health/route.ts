import { NextResponse } from "next/server";
import { getEffectiveDatabaseUrl, prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const sqliteOk = dbUrl.startsWith("file:");
  let effective = "";
  try {
    effective = getEffectiveDatabaseUrl();
  } catch {
    effective = "";
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    const fundCount = await prisma.fund.count();
    return NextResponse.json({
      ok: true,
      service: "fonvesting",
      timestamp: new Date().toISOString(),
      database: {
        configured: Boolean(dbUrl),
        sqliteRelativePath: sqliteOk,
        effectiveUrlPrefix: effective.slice(0, 72) + (effective.length > 72 ? "…" : ""),
        hint: "Shell’de export DATABASE_URL=... varsa .env’i ezer; yalnızca file: kullanın.",
      },
      funds: { count: fundCount },
    });
  } catch (error) {
    console.error("[health] failed:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        service: "fonvesting",
        timestamp: new Date().toISOString(),
        database: {
          configured: Boolean(dbUrl),
          sqliteRelativePath: sqliteOk,
          effectiveUrlPrefix: effective.slice(0, 72) + (effective.length > 72 ? "…" : ""),
          hint: "Öneri: .env.local içinde DATABASE_URL=\"file:./dev.db\" ve terminalde postgres URL export etmeyin. Sonra: npx prisma generate && yeniden npm run dev",
        },
        error: message.slice(0, 500),
      },
      { status: 503 }
    );
  }
}

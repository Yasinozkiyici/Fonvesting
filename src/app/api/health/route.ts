import { NextResponse } from "next/server";
import { getEffectiveDatabaseUrl, prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  let effective = "";
  try {
    effective = getEffectiveDatabaseUrl();
  } catch {
    effective = "";
  }
  const isPostgres = effective.startsWith("postgresql:") || effective.startsWith("postgres:");
  try {
    await prisma.$queryRaw`SELECT 1`;
    const fundCount = await prisma.fund.count();
    return NextResponse.json({
      ok: true,
      service: "fonvesting",
      timestamp: new Date().toISOString(),
      database: {
        configured: Boolean(dbUrl || process.env.NODE_ENV === "development"),
        engine: isPostgres ? "postgresql" : "unknown",
        effectiveUrlPrefix: effective.slice(0, 48) + (effective.length > 48 ? "…" : ""),
        hint: "Yerel: docker compose up -d ve .env içinde DATABASE_URL. Vercel: proje ortam değişkenlerinde DATABASE_URL.",
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
          engine: isPostgres ? "postgresql" : "unknown",
          effectiveUrlPrefix: effective.slice(0, 48) + (effective.length > 48 ? "…" : ""),
          hint: "PostgreSQL bağlantısını kontrol edin; migrate: pnpm exec prisma migrate deploy. Yerel varsayılan: localhost:5433 (docker-compose).",
        },
        error: message.slice(0, 500),
      },
      { status: 503 }
    );
  }
}

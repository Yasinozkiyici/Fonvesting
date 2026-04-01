import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      {
        ok: true,
        service: "bistmarketcap",
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[health] failed:", error);
    return NextResponse.json(
      {
        ok: false,
        service: "bistmarketcap",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function allowHealthDetail(headers: Headers): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const configuredSecret = process.env.HEALTH_SECRET?.trim();
  const provided = headers.get("x-health-secret")?.trim();
  if (configuredSecret && provided && provided === configuredSecret) return true;
  const cronSecret = process.env.CRON_SECRET?.trim();
  const auth = headers.get("authorization")?.trim() ?? "";
  return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
}

type Params = { params: { code: string } };

export async function GET(request: NextRequest, { params }: Params) {
  if (!allowHealthDetail(request.headers)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const code = decodeURIComponent(params.code ?? "").trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ ok: false, error: "invalid_code" }, { status: 400 });
  }

  const fund = await prisma.fund.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      lastUpdatedAt: true,
    },
  });

  if (!fund) {
    return NextResponse.json({ ok: false, error: "fund_not_found", code }, { status: 404 });
  }

  const [latestSnapshot, latestHistory, healthDaily, servingDetail] = await Promise.all([
    prisma.fundDailySnapshot.findFirst({
      where: { fundId: fund.id },
      orderBy: { date: "desc" },
      select: { date: true, updatedAt: true },
    }),
    prisma.fundPriceHistory.findFirst({
      where: { fundId: fund.id },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    prisma.fundHealthDaily.findFirst({
      where: { fundId: fund.id },
      orderBy: { date: "desc" },
    }).catch(() => null),
    prisma.servingFundDetail.findFirst({
      where: { fundCode: code },
      orderBy: { updatedAt: "desc" },
      select: { buildId: true, snapshotAsOf: true, status: true, updatedAt: true },
    }).catch(() => null),
  ]);

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    fund,
    canonical: {
      latestSnapshotDate: latestSnapshot?.date.toISOString() ?? null,
      latestSnapshotUpdatedAt: latestSnapshot?.updatedAt.toISOString() ?? null,
      latestHistoryDate: latestHistory?.date.toISOString() ?? null,
    },
    fundHealthDaily: healthDaily,
    servingDetailHead: servingDetail,
  });
}

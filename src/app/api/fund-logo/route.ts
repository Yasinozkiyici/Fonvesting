import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  resolveFundLogoUrl,
  isResolvedLogoFetchAllowed,
} from "@/lib/services/fund-logo.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LOGO_BYTES = 2_500_000;
const UPSTREAM_MS = 12_000;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const n = req.nextUrl.searchParams.get("n") ?? "";
  const s = req.nextUrl.searchParams.get("s") ?? "";

  let fundName = n;
  let stored = s;

  if (id) {
    const fund = await prisma.fund.findUnique({
      where: { id },
      select: { name: true, logoUrl: true },
    });
    if (!fund) {
      return new NextResponse(null, { status: 404 });
    }
    fundName = fund.name;
    stored = fund.logoUrl ?? "";
  }

  if (!fundName.trim()) {
    return new NextResponse(null, { status: 400 });
  }

  const target = resolveFundLogoUrl(stored || null, fundName);
  if (!target || !isResolvedLogoFetchAllowed(target, stored || null)) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FonvestingLogoProxy/1.0)",
        Accept: "image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(UPSTREAM_MS),
      next: { revalidate: 86_400 },
    });

    if (!upstream.ok) {
      return new NextResponse(null, { status: upstream.status === 404 ? 404 : 502 });
    }

    const buf = await upstream.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_LOGO_BYTES) {
      return new NextResponse(null, { status: 502 });
    }

    const ct =
      upstream.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return new NextResponse(null, { status: 504 });
  }
}

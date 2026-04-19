import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchSupabaseRestJson, hasSupabaseRestConfig } from "@/lib/supabase-rest";
import {
  resolveFundLogoUrl,
  isResolvedLogoFetchAllowed,
} from "@/lib/services/fund-logo.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LOGO_BYTES = 2_500_000;
const UPSTREAM_MS = 4_500;
/** Boş görünümlü 1×1 şeffaf PNG — harici logo yok / upstream 404 durumunda 200 döner */
const FALLBACK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/webp",
  "image/svg+xml",
  "image/jpeg",
  "image/gif",
  "image/avif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

function readLocalFundLogoBuffer(code: string): { buf: Buffer; contentType: string } | null {
  const base = path.join(process.cwd(), "public", "fund-logos");
  const c = code.trim().toUpperCase();
  const map: Record<string, string> = {
    png: "image/png",
    webp: "image/webp",
    svg: "image/svg+xml",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
  };
  for (const ext of ["png", "webp", "svg", "jpg", "jpeg"] as const) {
    const fp = path.join(base, `${c}.${ext}`);
    if (!fs.existsSync(fp)) continue;
    const buf = fs.readFileSync(fp);
    if (buf.length === 0 || buf.length > MAX_LOGO_BYTES) return null;
    return { buf, contentType: map[ext] ?? "application/octet-stream" };
  }
  return null;
}

type FundLogoRow = {
  code: string;
  name: string;
  logoUrl: string | null;
};

async function loadFundLogoRowById(id: string): Promise<FundLogoRow | null> {
  if (hasSupabaseRestConfig()) {
    try {
      const query = new URLSearchParams({
        select: "code,name,logoUrl",
        id: `eq.${id}`,
        limit: "1",
      });
      const rows = await fetchSupabaseRestJson<FundLogoRow[]>(`Fund?${query.toString()}`, { revalidate: 86_400 });
      const row = rows[0];
      if (row) return row;
      return null;
    } catch (error) {
      console.error("[fund-logo] supabase-rest lookup failed", error);
    }
  }

  const fund = await prisma.fund.findUnique({
    where: { id },
    select: { name: true, logoUrl: true, code: true },
  });
  if (!fund) return null;
  return fund;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const n = req.nextUrl.searchParams.get("n") ?? "";
  const s = req.nextUrl.searchParams.get("s") ?? "";

  let fundName = n;
  let stored = s;

  if (id) {
    const fund = await loadFundLogoRowById(id);
    if (!fund) {
      return new NextResponse(new Uint8Array(FALLBACK_PNG), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=3600",
          "X-Fund-Logo-Fallback": "missing_fund_row",
        },
      });
    }
    const local = readLocalFundLogoBuffer(fund.code);
    if (local) {
      return new NextResponse(new Uint8Array(local.buf), {
        status: 200,
        headers: {
          "Content-Type": local.contentType,
          "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
        },
      });
    }
    fundName = fund.name;
    stored = fund.logoUrl ?? "";
  }

  if (!fundName.trim()) {
    return new NextResponse(new Uint8Array(FALLBACK_PNG), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=60",
        "X-Fund-Logo-Fallback": "missing_name",
      },
    });
  }

  const target = resolveFundLogoUrl(stored || null, fundName);
  if (!target || !isResolvedLogoFetchAllowed(target, stored || null)) {
    return new NextResponse(new Uint8Array(FALLBACK_PNG), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
        "X-Fund-Logo-Fallback": "unresolved_url",
      },
    });
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
      if (upstream.status === 404) {
        return new NextResponse(new Uint8Array(FALLBACK_PNG), {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=600",
            "X-Fund-Logo-Fallback": "upstream_404",
          },
        });
      }
      return new NextResponse(new Uint8Array(FALLBACK_PNG), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=120",
          "X-Fund-Logo-Fallback": "upstream_error",
        },
      });
    }

    const buf = await upstream.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_LOGO_BYTES) {
      return new NextResponse(new Uint8Array(FALLBACK_PNG), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=300",
          "X-Fund-Logo-Fallback": "invalid_bytes",
        },
      });
    }

    const ct =
      upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
    if (!ALLOWED_IMAGE_CONTENT_TYPES.has(ct)) {
      return new NextResponse(new Uint8Array(FALLBACK_PNG), {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=300",
          "X-Fund-Logo-Fallback": "bad_content_type",
        },
      });
    }

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return new NextResponse(new Uint8Array(FALLBACK_PNG), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=120",
        "X-Fund-Logo-Fallback": "fetch_error",
      },
    });
  }
}

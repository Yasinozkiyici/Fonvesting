import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Tarayıcıda /api açılınca 404 olmasın; alt uçların listesi. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "fonvesting",
    message: "Alt yolları kullanın; kök /api yalnızca bu listeyi döner.",
    endpoints: {
      health: "/api/health",
      funds: "/api/funds?pageSize=10",
      market: "/api/market",
      categories: "/api/categories",
      fundTypes: "/api/fund-types",
      diagnosticsPage: "/diagnostics",
      statusPage: "/status",
    },
  });
}

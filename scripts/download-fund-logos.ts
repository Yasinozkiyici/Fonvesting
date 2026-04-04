/**
 * TEFAS fon kodlarına göre harici görsel URL şablonundan logo indirir.
 *
 * Kullanım:
 *   1) Tarayıcıda (Fitables / Fintables vb.) bir fon sayfasında DevTools → Network → Img
 *      ile gerçek logo isteğinin URL’sini kopyalayın.
 *   2) Fon kodunun geçtiği yeri `{code}` ile değiştirin (büyük harf: TI2, AAA…).
 *   3) .env içine örneğin:
 *      FUND_LOGO_SOURCE_TEMPLATE="https://ornek-cdn.com/funds/{code}.png"
 *
 *   pnpm run download:fund-logos
 *   pnpm run download:fund-logos -- --dry-run
 *   pnpm run download:fund-logos -- --limit 5
 *   pnpm run download:fund-logos -- --manifest-only   (sadece manifest.json yenile)
 *
 * Telif / kullanım koşulları: Görselleri yalnızca ilgili sitenin izin verdiği ölçüde kullanın.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

import { rebuildFundLogosManifest } from "../src/lib/fund-logos-manifest";

const MAX_BYTES = 5_000_000;
const FETCH_MS = 20_000;
const CONCURRENCY = 4;

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    dryRun: argv.includes("--dry-run"),
    manifestOnly: argv.includes("--manifest-only"),
    limit: (() => {
      const i = argv.indexOf("--limit");
      if (i === -1 || argv[i + 1] === undefined) return null;
      const n = Number(argv[i + 1]);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
  };
}

function extFromContentType(ct: string | null): string {
  const base = ct?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base.includes("svg")) return "svg";
  if (base.includes("webp")) return "webp";
  if (base.includes("jpeg") || base.includes("jpg")) return "jpg";
  if (base.includes("png")) return "png";
  return "png";
}

function buildUrl(template: string, codeUpper: string, codeLower: string): string {
  return template.split("{code_lower}").join(codeLower).split("{code}").join(codeUpper);
}

async function main() {
  const { dryRun, manifestOnly, limit } = parseArgs();
  const dir = path.join(process.cwd(), "public", "fund-logos");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (manifestOnly) {
    rebuildFundLogosManifest();
    console.log(JSON.stringify({ ok: true, message: "manifest rebuilt" }));
    return;
  }

  const template = process.env.FUND_LOGO_SOURCE_TEMPLATE?.trim();
  if (!template || !template.includes("{code}")) {
    console.error(
      "FUND_LOGO_SOURCE_TEMPLATE eksik veya {code} içermiyor. .env örneği için .env.example dosyasına bakın."
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const funds = await prisma.fund.findMany({
      where: { isActive: true },
      select: { code: true },
      orderBy: { code: "asc" },
    });
    const rows = limit ? funds.slice(0, limit) : funds;

    let ok = 0;
    let skipped = 0;
    let failed = 0;

    const queue = [...rows];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const row = queue.shift();
        if (!row) break;
        const codeUpper = row.code.trim().toUpperCase();
        const codeLower = row.code.trim().toLowerCase();
        const url = buildUrl(template, codeUpper, codeLower);

        if (dryRun) {
          console.log(url);
          ok += 1;
          continue;
        }

        try {
          const res = await fetch(url, {
            headers: {
              Accept: "image/*,*/*;q=0.8",
              "User-Agent": "Mozilla/5.0 (compatible; FonvestingFundLogoSync/1.0)",
            },
            signal: AbortSignal.timeout(FETCH_MS),
          });
          if (!res.ok) {
            failed += 1;
            continue;
          }
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length === 0 || buf.length > MAX_BYTES) {
            failed += 1;
            continue;
          }
          const ext = extFromContentType(res.headers.get("content-type"));
          const filePath = path.join(dir, `${codeUpper}.${ext}`);
          fs.writeFileSync(filePath, buf);
          ok += 1;
        } catch {
          failed += 1;
        }
      }
    });

    await Promise.all(workers);
    rebuildFundLogosManifest();

    console.log(
      JSON.stringify({
        ok: true,
        dryRun,
        total: rows.length,
        downloadedOrListed: ok,
        failed,
      })
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Tüm TEFAS fonlarını (tür 0 + 1) çeker, kategorileri ve logoları günceller.
 * Gereksinim: Python venv (scripts/setup:venv), Chrome/Selenium (tefasfon).
 *
 * Kullanım: pnpm exec tsx scripts/full-tefas-import.ts
 * Ortam: .env.local içinde DATABASE_URL (Supabase pooler veya doğrudan).
 */
import { config } from "dotenv";
import path from "node:path";
import { runFullTefasSync } from "../src/lib/services/tefas-sync.service";

config({ path: path.join(process.cwd(), ".env"), quiet: true });
config({ path: path.join(process.cwd(), ".env.local"), override: true, quiet: true });

runFullTefasSync()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok || r.skipped ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

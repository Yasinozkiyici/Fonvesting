/**
 * FundDerivedMetrics tablosunu 2 yıllık fiyat geçmişinden yeniden hesaplar.
 *
 *   pnpm exec tsx scripts/rebuild-derived-metrics.ts
 */
import { config } from "dotenv";
import path from "node:path";
import { rebuildFundDerivedMetrics } from "../src/lib/services/fund-derived-metrics.service";

const cwd = process.cwd();
config({ path: path.join(cwd, ".env"), quiet: true });
config({ path: path.join(cwd, ".env.local"), override: true, quiet: true });

rebuildFundDerivedMetrics()
  .then((r) => {
    console.log(JSON.stringify({ ok: true, ...r }));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

/**
 * FundDerivedMetrics tablosunu 2 yıllık fiyat geçmişinden yeniden hesaplar.
 *
 *   pnpm exec tsx scripts/rebuild-derived-metrics.ts
 */
import "./load-env";
import { rebuildFundDerivedMetrics } from "../src/lib/services/fund-derived-metrics.service";

rebuildFundDerivedMetrics()
  .then((r) => {
    console.log(JSON.stringify({ ok: true, ...r }));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

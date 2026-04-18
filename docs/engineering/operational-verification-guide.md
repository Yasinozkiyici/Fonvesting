# Operational Verification Guide (v2)

## Goal

Sistemin yalnızca “çalışıyor görünmesini” değil, gerçekten **doğru/aligned/fresh** olduğunu kanıtlamak.

## Standard Command Chain

1. `pnpm data:sync:daily` (veya `pnpm data:backfill:full`)
2. `pnpm data:rebuild:serving`
3. `pnpm data:verify`
4. `pnpm data:health:report --strict`
5. `pnpm verify:critical-routes`
6. `pnpm smoke:data`
7. `pnpm smoke:ui:prodlike`
8. `SMOKE_BASE_URL=<target> pnpm data:release:gate`

## How To Read `data:verify` Output

- `gateDecision=NO_GO`: cutover bloklanır.
- `checks[layer=raw]`: parse failure, raw freshness, source failure yoğunluğu.
- `checks[layer=canonical]`: kritik metrik boşlukları ve snapshot kapsaması.
- `checks[layer=serving]`: buildId alignment, list/detail/compare code hizası, chart payload şekli.
- `checks[layer=health]`: stale day ve readiness semantik doğruluğu.

## Required Diagnostic Outputs

- Rebuild summary: `runServingRebuild` çıktısı (timings + written counts + v2Serving summary).
- Data health report: `pnpm data:health:report`.
- Serving alignment: `/api/health/serving`.
- Source/parse failures: `rawPricesParseFailedCount`, `rawFailedSourceCount`.
- Fund-level diagnostics: `/api/health/fund/[code]`.

## Decision Rules

- **Immediate NO_GO**
  - serving table population fail
  - buildId mismatch
  - critical route contract break
  - semantic health inconsistency
  - stale canonical/serving breach
- **LIMITED_GO candidate**
  - critical checks pass, sadece warning sınıfı riskler var
  - rollback yolu test edilmiş
- **GO**
  - tüm blocker kontrolleri geçti
  - prodlike + target URL gate geçti
  - cutover report template tam dolu

## Incident Triage Shortcuts

- “Data fresh mi?”: `data:verify` freshness checks + `/api/health/data`.
- “List/detail/compare aligned mı?”: serving build alignment + code set check + `/api/health/serving`.
- “Hangi kaynak patladı?”: raw failed source count + parse failure dağılımı.
- “Kesebilir miyiz?”: `gateDecision` + release gate sonuçları.

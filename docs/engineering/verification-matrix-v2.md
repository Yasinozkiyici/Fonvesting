# Verification Matrix v2

| Area | Check | Automation | Gate Type |
|---|---|---|---|
| Raw payload ingestion | `rawPricesRowCount > 0` | `pnpm data:verify` | Blocker |
| Malformed payload handling | parse failure ratio (`<=2%`) + validator test | `pnpm data:verify` + unit tests | Blocker |
| Idempotent reruns | checksum dedup behavior | `ingest-raw` logic + integration replay (manual evidence) | Evidence-required |
| Canonical row correctness | latest snapshot critical metric validity | `pnpm data:verify` | Blocker |
| Derived metric determinism | derived writes + non-null scores | serving rebuild outputs + health checks | Warn/Block (context) |
| Serving table population | list/detail/compare/discovery/system non-empty | `pnpm data:verify` + `data:release:gate` | Blocker |
| BuildId alignment | list/detail/compare/discovery/system same buildId | `pnpm data:verify` + `/api/health/serving` | Blocker |
| Freshness / staleness | raw/canonical/serving stale day budgets | `pnpm data:verify` + `/api/health/data` | Blocker |
| Health semantic truthfulness | readiness + status coherence | `pnpm data:verify` + `data:release:gate` | Blocker |
| Fallback/degraded correctness | critical routes degraded scenario | `pnpm verify:critical-routes` | Blocker |
| Prod build/runtime parity | build artifact + `next start` + UI flow | `pnpm smoke:ui:prodlike` | Blocker |
| Backfill vs daily sync | both run outputs comparable | runbook/manual evidence + report | Evidence-required |
| Partial source failure | failed source counts + degraded route contracts | `pnpm data:verify` + `verify:critical-routes` | Warn/Block |
| Empty/sparse source day | explicit degraded semantics without fake success | `verify:critical-routes` scenario + health checks | Blocker |
| Route contract integrity | list/detail/compare/compare-series shape | `smoke:data` + `verify:critical-routes` | Blocker |
| UI smoke on prodlike artifact | homepage search/filter + detail compare | `smoke:ui:prodlike` | Blocker |

## Execution Order (Release Candidate)

1. `pnpm data:sync:daily` (veya backfill zinciri)
2. `pnpm data:rebuild:serving`
3. `pnpm data:verify`
4. `pnpm verify:critical-routes`
5. `pnpm smoke:data`
6. `pnpm smoke:ui:prodlike`
7. `pnpm data:release:gate` (target URL)

## Mandatory Evidence Artifacts

- `data:verify` JSON çıktısı (checks + gateDecision)
- `verify:critical-routes` normal + degraded sonuçları
- `smoke:ui:prodlike` sonucu (production artifact)
- `data:release:gate` sonucu (target URL)

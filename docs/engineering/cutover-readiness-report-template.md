# Cutover Readiness Report Template (v2)

## 1) Build / Run Identity

- Date:
- Candidate build commit:
- Serving buildId:
- Snapshot asOf:
- Environment (staging/preview/prod):

## 2) Mandatory Gate Results

- `pnpm data:verify`: PASS/FAIL (attach JSON)
- `pnpm verify:critical-routes` normal: PASS/FAIL
- `pnpm verify:critical-routes` degraded: PASS/FAIL
- `pnpm smoke:data`: PASS/FAIL
- `pnpm smoke:ui:prodlike`: PASS/FAIL
- `pnpm data:release:gate` (target URL): PASS/FAIL

## 3) Data Integrity Evidence

- Raw parse failure ratio:
- Failed source count:
- Canonical missing critical metric count:
- Serving list/detail/compare/discovery/system row counts:
- List/detail/compare code alignment evidence:

## 4) Freshness & Staleness Evidence

- Raw freshness (days):
- Canonical freshness (days):
- Serving freshness (days):
- `/api/health/data` staleDays:
- Any stale/degraded flags:

## 5) Partial Failure / Degraded Semantics

- Which degraded scenarios were observed:
- Did APIs preserve contract-safe degraded response:
- Did UI preserve usable degraded state:
- Any silent fallback detected:

## 6) Prodlike Parity Evidence

- Production build artifact used: Yes/No
- `next start` runtime smoke passed: Yes/No
- Homepage search/filter:
- Detail page compare/alternatives:
- Compare flow:
- Runtime asset/caching mismatch found:

## 7) GO / NO-GO Decision

- Decision: GO / LIMITED_GO / NO_GO
- Blocking failures:
- Residual risks:
- Owner sign-off:

## 8) Rollback Plan

- Trigger conditions:
- Rollback method:
- Max rollback execution time:
- Post-rollback validations:

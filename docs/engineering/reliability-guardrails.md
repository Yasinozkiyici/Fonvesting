# Reliability Guardrails

## Core principle

Fonvesting is **snapshot-first** and **reliability-first** for production reads.  
No feature or fix may introduce fragile live dependencies into critical user flows when durable snapshot/materialized data exists.

## Data rules

1. Daily ingestion **must be idempotent** (re-run safe, no duplicate side effects).
2. Publish **must occur only after validation passes**.
3. Last-known-good data **must never be replaced** by partial, stale, or invalid output.
4. Every critical dataset **must expose freshness metadata** (at minimum: source date, published-at, freshness age).
5. Fetch success and publish success **must be tracked separately**.

## API rules

1. Every critical API must define and document:
   - primary source
   - degraded source(s)
   - empty-response contract
2. If durable materialized data exists, API **must not prefer fragile live paths**.
3. Critical APIs **must not return silent empty payloads** for critical screens; explicit degraded semantics are required.
4. Degraded responses must remain contract-safe (shape-compatible with normal responses).
5. API handlers must fail soft where possible and include diagnostics suitable for production triage.

## UI rules

1. Charts, comparison, and alternatives modules must support **partial success** safely.
2. Missing secondary modules must **not collapse the full page**.
3. Stale/degraded states must render without layout breakage or blank-screen regressions.
4. UI must prioritize continuity: primary content first, enrichment modules second.
5. A module failure must be contained to its own boundary.

## Job rules

1. Every scheduled job must emit run records with status transitions.
2. Every job must support retry and/or manual replay.
3. Missed-run detection is mandatory (time-window/cutoff based).
4. Stale RUNNING detection/recovery is mandatory for long-running jobs.
5. Fetch and publish statuses must be separate and observable.

## Release rules

1. No deploy without critical-path checks passing.
2. Comparison, chart, and alternatives flows must have regression coverage.
3. Freshness checks are mandatory in release readiness.
4. Degraded-mode behavior must be validated for critical APIs and pages.
5. Any failure in reliability gates blocks release.
6. `Release Critical Gate` workflow pass is mandatory before production deploy.
7. `verify:release-critical` failure is a hard blocker (no exception for "works locally").

## Logging and observability rules

1. Use structured logs only (machine-parseable fields).
2. Include run IDs and request correlation IDs where possible.
3. Critical-path failures must be diagnosable from logs without guesswork.
4. Logs must include decision context (source selected, fallback selected, failure class).
5. Health/readiness surfaces must expose latest successful ingestion and publish timestamps.

## Merge checklist (mandatory)

- [ ] Primary source, degraded source(s), and empty contract are defined for impacted critical APIs.
- [ ] Change does not introduce a fragile live read path over an existing durable snapshot/materialized source.
- [ ] Freshness metadata is present and verified for impacted datasets.
- [ ] Partial/degraded UI behavior is implemented and visually safe (no page collapse).
- [ ] Scheduled-job impacts include run-status, missed-run detection, and replay/retry path.
- [ ] Critical-path tests and regression checks (comparison/chart/alternatives + freshness) pass.
- [ ] `pnpm run verify:release-critical` passed (normal + degraded scenarios).
- [ ] `Release Critical Gate` workflow passed for target deployment URL.
- [ ] Production logs for this change are diagnosable (run/request correlation and failure class present).
- [ ] Release gate checks pass; no unresolved reliability blocker remains.

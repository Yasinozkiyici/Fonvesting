# Production Serving Stabilization Policy

## Runtime DB Path (Serverless)

- Runtime Prisma URL precedence is `POSTGRES_PRISMA_URL` -> `DATABASE_URL`.
- Runtime APIs must use pooled URL (`pooler.supabase.com:6543` + `pgbouncer=true`).
- `DIRECT_URL` is reserved for migrations and explicit operational tasks.
- Default runtime pool guardrail is conservative for serverless fan-out:
  - `connection_limit=1` (unless explicitly overridden)
  - `pool_timeout=8`
  - `connect_timeout=10`

## Direct DB Usage Rules

- Never route hot user-facing APIs to direct `db.*.supabase.co:5432` in production.
- Never treat migration/admin URLs as runtime datasource.
- Any runtime mismatch must surface in logs/headers, not silently fallback.

## Hot Endpoint Strategy (`/api/funds/scores`)

- Prefer serving index/list materialized payloads when available.
- Use short in-process cache for serving primary reads to avoid repeated DB pressure on burst traffic.
- Keep request-level fallback deterministic:
  - stale cache/persisted cache/serving fallback
  - explicit degraded reason
- Do not return silent false-empty when timeout/pool pressure is the cause.

## Freshness and Degraded Contract

- Canonical states remain:
  - `fresh`
  - `stale_ok`
  - `degraded_outdated`
- Required response headers for critical surfaces:
  - `X-Data-Freshness-State`
  - `X-Data-Freshness-Reason`
  - `X-Data-Freshness-As-Of`
  - `X-Data-Freshness-Age-Ms`
- Degraded states must be explicit and user-trust preserving (no fake healthy UI).

## Post-Deploy Verification Checklist

- `pnpm run smoke:data` passes (scores/compare/compare-series freshness headers present).
- `pnpm run smoke:routes` passes (homepage/detail/compare typed surface states).
- `/api/funds/scores?mode=BEST` returns non-empty under healthy load.
- No sustained `P2024` / `pool_checkout_timeout` in runtime logs.
- Release summary includes:
  - DB/connection health
  - freshness contract health
  - route/runtime correctness
  - latency advisory

# Data platform — phase raporu (2026-04-17)

Özet: Phase 1 denetim belgeleri tamamlandı; Phase 2 için şema (parallel-run), ingestion iskeleti, `data:*` scriptleri, ayrıntılı health uçları ve deterministik `buildId` testi eklendi.

## Tam dosya listesi (bu oturum)

### Dokümantasyon
- `docs/engineering/system-rebuild-audit.md`
- `docs/engineering/target-data-architecture.md`
- `docs/engineering/rebuild-runbook.md`
- `docs/engineering/data-debugging-guide.md`
- `docs/release/data-platform-cutover-checklist.md`
- `docs/engineering/phase-report-data-platform-2026-04-17.md`

### Veritabanı
- `prisma/schema.prisma` (raw, serving, `fund_health_daily`)
- `prisma/migrations/20260417150000_data_platform_raw_serving_v1/migration.sql`

### Ingestion / domain
- `src/lib/ingestion/types.ts`
- `src/lib/ingestion/logging/pipeline-log.ts`
- `src/lib/ingestion/validators/raw-payload-shape.ts`
- `src/lib/ingestion/adapters/base-adapter.ts`
- `src/lib/ingestion/adapters/tefas-prices.adapter.ts`
- `src/lib/ingestion/pipeline/ingest-raw.ts`
- `src/lib/domain/serving/build-id.ts`
- `src/lib/domain/serving/build-id.test.ts`
- `src/lib/domain/serving/index.ts`
- `src/lib/domain/funds/index.ts`
- `src/lib/domain/metrics/index.ts`
- `src/lib/domain/discovery/index.ts`
- `src/lib/domain/compare/index.ts`
- `src/lib/data-platform/serving-head.ts`

### API
- `src/app/api/health/data/route.ts`
- `src/app/api/health/serving/route.ts`
- `src/app/api/health/fund/[code]/route.ts`
- `src/app/api/route.ts` (endpoint listesi)

### Scriptler
- `scripts/data-platform/backfill-full.ts`
- `scripts/data-platform/sync-daily.ts`
- `scripts/data-platform/rebuild-serving.ts`
- `scripts/data-platform/verify.ts`
- `scripts/data-platform/repair.ts`
- `scripts/data-platform/health-report.ts`
- `package.json` (`data:*` scriptleri)

## Mimari kararlar

- Legacy tablolar korunarak **parallel-run** tabloları eklendi; cutover ayrı kontrol listesi ile.
- `ServingFundDetail` **(buildId, fundCode)** unique; liste/diğer serving tabloları **buildId** unique (tek satır / build).
- `TefasPricesAdapter` şimdilik stub; gerçek browser path aşamalı bağlanacak.
- Health alt uçları prod’da **CRON_SECRET** veya **HEALTH_SECRET** ile korunuyor (`/api/health/data` ile aynı model).

## Kaldırılan legacy

- Yok (bilinçli; cutover öncesi risk).

## Komutlar (doğrulama)

- `pnpm exec prisma validate`
- `pnpm exec prisma generate`
- `pnpm exec tsc --noEmit`
- `pnpm run test:unit` — geçti (120 test).

## Test sonuçları

- Unit: başarılı; yeni: `computeServingBuildId` determinizm testleri.

## Kalan riskler

- Yeni tablolar üretimde `migrate deploy` gerektirir; scriptler DB olmadan tam çalışmaz.
- `data:repair` ops alert tetikleyebilir (`runDailyRecovery`).
- Serving tabloları henüz pipeline tarafından doldurulmuyor; Phase 4’te yazılacak.

## Sonraki phase hazırlığı

- **Phase 3:** TEFAS/makro adapter’larını `ingest-raw` + normalize ile bağla; `raw_*` doldur.
- **Phase 4:** `serving_*` üretimi (`buildId` ile atomik); scores/detail/compare tüketimi.
- **Phase 5–6:** Cache anahtarını `buildId` ile hizala; UI’da dürüst eksik state.

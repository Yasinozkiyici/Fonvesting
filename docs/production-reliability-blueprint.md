# Production Reliability Blueprint (Fonvesting)

Bu dokuman, fonvesting icin ozellikle gunluk veri alimi + snapshot serving + API degrade + UI dayaniklilik ekseninde zorunlu guvenilirlik modelini tanimlar.

## A) Reliability operating model

### 1) Ingestion layer
- Sorumluluk: Gunluk TEFAS/makro veri cekimi ve ham yazim.
- Failure mode: kaynak timeout, kismi cekim, stale gun, duplicate run.
- Izolasyon: ingestion yalniz ham veriyi yazar; publish/snapshot bu katmandan bagimsiz gate ile calisir.

### 2) Normalization / validation layer
- Sorumluluk: tarih hizalama, numeric guard, session-date uygunlugu.
- Failure mode: malformed satir, beklenen business-day eksigi, anomali.
- Izolasyon: validation fail olursa publish bloke edilir; onceki snapshot aktif kalir.

### 3) Snapshot / materialization layer
- Sorumluluk: serving-safe `FundDailySnapshot`, `MarketSnapshot`, core serving artifact uretimi.
- Failure mode: rebuild timeout, eksik coverage, partial yazim.
- Izolasyon: atomik publish; previous-good snapshot okunabilir kalir.

### 4) Serving / cache layer
- Sorumluluk: precomputed cache/artifact ile request path stabilizasyonu.
- Failure mode: cache miss, stale cache, DB checkout timeout.
- Izolasyon: file-first + cached fallback; runtime live query tekil opt-in.

### 5) API response / degrade layer
- Sorumluluk: kritik endpointlerde deterministic payload + degrade metadata.
- Failure mode: primary source unavailable, secondary source bos, timeout.
- Izolasyon: non-empty degraded source zorunlu; hard empty yalniz explicit contract ile.

### 6) UI stale / degraded-state layer
- Sorumluluk: chart/compare/alternatives bolumlerinde kismi veriyle guvenli render.
- Failure mode: secondary data eksiginde tum sayfanin cokusmesi.
- Izolasyon: primary chart ayakta kalir; compare/alternatives bagimsiz fallback copy ile ayrisir.

### 7) Release verification layer
- Sorumluluk: deploy oncesi kritik path kontrat dogrulamasi.
- Failure mode: prod-only contract drift, stale data regressions.
- Izolasyon: gate fail olursa release bloklanir.

## B) Non-negotiable reliability rules

- Her scheduled ingestion idempotent olmak zorunda.
- Her run `SyncLog` kaydi uretmek zorunda (`started_at`, `completed_at`, `status`, `duration`, hata detayi).
- `daily_sync` kaydinda fetch (source) ve publish (snapshot) sonucu ayri izlenmek zorunda.
- Materialized veri varsa kritik API hard-empty donemez; degrade source kullanmak zorunda.
- UI, latest live data yok diye hard-fail olamaz; snapshot-backed fallback zorunlu.
- Compare/chart/alternatives once snapshot-backed modelden beslenir, live join ancak ikincil.
- Type/lint/contract/smoke gate fail ise release engellenir.

## C) Daily ingestion hardening

- `SyncLog(syncType=daily_sync)` standart run kaydi.
- Alanlar: `startedAt`, `completedAt`, `status`, `fundsUpdated`, `fundsCreated`, `durationMs`, `errorMessage(JSON meta)`.
- JSON meta: `runKey(istanbul date)`, `sourceStatus`, `publishStatus`, `firstFailedStep`, `failureKind`.
- Retry: source refresh icinde bounded retry + timeout.
- Idempotency: overlap guard + stale RUNNING recovery.
- Stale-run detection: TTL asimi RUNNING -> FAILED/TIMEOUT.
- Alert: cutoff sonrasi `daily_sync SUCCESS` yoksa health issue (error).
- Manual rerun: cron endpoint auth + existing scripts (`scripts/rebuild-serving-layer.ts`, `scripts/sync-tefas-history.ts`) ile kontrollu rerun.
- Fetch success != publish success ayrimi zorunlu.

## D) Snapshot / materialization policy

- Freshness contract: beklenen business session >= son snapshot.
- Publish yalniz validation gecerse SUCCESS.
- Previous-good snapshot her zaman read pathte korunur.
- Atomik publish: artifact replace + DB upsert sekanslari.
- Versiyon/pattern: timestamp + sourceDate metadata ile serving artifact.

## E) API resilience policy

- Primary source: snapshot/materialized read.
- Degraded source: file cache -> DB cache -> limited fallback hesap.
- Empty policy: kritik endpointte sadece "hic veri yok" durumu explicit oldugunda.
- Diagnostik: health headerlari + sync/log metadata.
- Kural: durable snapshot varken canli/fragile query primary olamaz.

## F) Comparison/chart/alternatives stabilization

- Comparison: `compare-series` snapshot-backed core payloaddan uretilir.
- Price chart: secondary compare fail olsa da primary fiyat serisi render olur.
- Alternatives: request-time fragile join yerine deterministic precomputed/cache kaynak.
- Missing secondary data: sayfa cokusmez, bolgesel fallback.

## G) Release gates and regression guards

Zorunlu:
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- Kritik API contract testleri (`/api/health`, `/api/funds`, `/api/funds/scores`, `/api/funds/compare-series`)
- Gunluk freshness smoke (`daily_sync` + snapshot dates)
- Compare route sanity
- Chart payload sanity
- Alternatives payload sanity
- Degraded-mode testleri (DB yavas/unstable durumda soft degrade)

## H) Observability and alerting

- Structured log: cron run id/runKey, step status, failureKind.
- Job outcome metric: SUCCESS/FAILED/TIMEOUT sayaci.
- Freshness health: latest snapshot dates + last successful ingestion/publish.
- Critical path counters: compare/chart/detail core hata siniflari.
- Alert kosulu: Istanbul cutoff sonrasi `daily_sync` tamamlanmadiysa error.

## I) Future development guardrails

- Yeni read-path once snapshot-backed servis katmanina eklenir.
- Yeni API, degrade davranisi ve non-empty fallback tanimlamadan merge edilmez.
- Yeni scheduled job, idempotency + run kaydi + stale recovery olmadan merge edilmez.
- Feature PR, kritik pathte degraded behavior testi icermeli.

## Phased roadmap

### Phase 1 (bu hafta)
- `daily_sync` run metadata standardizasyonu (source/publish ayrimi).
- Health endpointte son basarili ingestion/publish alanlari.
- Cutoff bazli daily_sync SLA issue.
- Release checkliste reliability gate maddeleri.

### Phase 2 (sonraki hardening cycle)
- Snapshot publish transaction boundarylerinin daha katı atomiklestirilmesi.
- API contract test suite: compare/chart/alternatives degraded senaryolari.
- Alternatives icin precomputed serving tablosu/cachesi.

### Phase 3 (surekli operasyon)
- Haftalik reliability review (missed SLA, timeout trendleri, stale incidents).
- SLO/SLA raporlama (daily sync completion, API degrade ratio).
- Yeni feature PR’larinda zorunlu reliability checklist.

## Likely modules/files

- `src/app/api/cron/daily/route.ts`
- `src/lib/system-health.ts`
- `src/lib/daily-sync-policy.ts`
- `src/app/api/health/route.ts`
- `docs/release-checklist.md`
- `docs/production-reliability-blueprint.md`
- (sonraki faz) `src/lib/services/*` altinda snapshot publish guardlari + alternatives serving cache

## Recommended implementation order

1. Run kaydi standardizasyonu (`daily_sync` meta).
2. Health/freshness sinyalleri ve cutoff issue.
3. API contract/degraded smoke testleri.
4. Snapshot publish atomiklestirme.
5. UI modules (compare/chart/alternatives) icin deterministic serving enforcement.

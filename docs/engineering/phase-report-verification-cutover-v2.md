# Phase Report — Verification & Cutover Readiness v2

## Delivered

- Verification gap analizi oluşturuldu (`verification-gap-analysis.md`).
- Tam verification matrisi tanımlandı (`verification-matrix-v2.md`).
- `data:verify` scripti, satır sayımı ötesine geçerek contract/alignment/freshness/semantic kontrollerle güçlendirildi.
- Raw payload shape validator genişletildi ve test eklendi.
- Target URL için data release gate scripti eklendi (`data:release:gate`).
- Release Critical Gate workflow’una data-platform gate adımı eklendi.
- Cutover checklist operasyonel, kanıt-zorunlu hale getirildi.
- Cutover readiness rapor şablonu ve operasyonel doğrulama rehberi eklendi.
- **Strict cutover enforcement** eklendi: kritik route’lar strict modda fallback/degraded ile 200 dönmek yerine açık `serving_strict_violation` ile 503 dönecek şekilde sertleştirildi.
- Prodlike build-integrity kontrolü sertleştirildi: vendor-chunk/module-resolution hataları (`Cannot find module`, özellikle `vendor-chunks/*`) build veya runtime page-generation aşamasında route kanıtı ile fail ediyor.
- Daily truth modeli release gate’e blocker olarak bağlandı: missed-run, publish-lag, publish-failed, source-quality anomaly ve strict-success dışı outcome artık release’i düşürüyor.

## Added/Upgraded Automated Checks

- Raw parse failure budget (`<=2%`).
- Distinct failed source count monitoring.
- Canonical critical metrics integrity check.
- Serving population check (list/detail/compare/discovery/system).
- BuildId alignment check (list/detail/compare/discovery/system + world meta).
- List/detail/compare code set mismatch detection.
- Malformed chart series detection (serving detail payload sampling).
- Raw/canonical/serving freshness checks.
- Health semantic truthfulness check.
- Target deployment URL için health/data/serving + critical routes gate.
- Route-level strict mode fallback policy check (`x-serving-strict: 1` + `SERVING_CUTOVER_STRICT=1`).
- Strict mode header doğrulaması: `X-Serving-Strict-Mode`, `X-Serving-Strict-Violation`, `X-Serving-Strict-Reason`.
- Strict mode build/world delili: world id + build id alignment + trust/fallback header kontrolü.
- `data:release:gate` içinde strict cutover matrix: `/api/funds`, `/api/funds/scores`, `/api/funds/compare`, `/api/funds/compare-series`, `/api/market`.
- `smoke:ui:prodlike` içinde build output ve runtime route probe integrity check: `/`, `/fund/VGA`, `/compare`, `/api/funds/compare?codes=VGA,TI1`.
- `data:release:gate` içinde daily reliability blocker seti:
  - `daily_sync_not_completed_today`
  - `daily_sync_publish_lag`
  - `daily_sync_publish_failed`
  - `daily_sync_source_quality` (`empty_source_anomaly` / `partial_source_failure`)
  - `daily_sync_outcome_strict_success`
- Daily blocker evidence alanları:
  - `lastRunTimestamp`
  - `processedSnapshotDate`
  - `outcome`
  - `sourceStatus`
  - `publishStatus`
  - `sourceQuality`
  - `publishBuildId`
  - `publishLagHours`

## Release Gates

- `Release Critical Gate` workflow adımları:
  1. critical route checks (normal + degraded)
  2. **data platform release gate (strict cutover + daily reliability blocker aware)**
  3. release readiness chain (prodlike + target)

## Daily Truth Release Status

- **Fail-loud aktif:** Evet. Daily reliability kontratı strict başarı dışına çıkarsa gate fail oluyor.
- **Old-log tolerance:** Eski `daily_sync` satırlarında yeni alan eksikse “healthy” varsayılmıyor; karar en güncel run üzerinden veriliyor.
- **Çıktı netliği:** `data:release:gate` günlük run doğruluk alanlarını ve `blockerReasons` listesini üretir.

## Consecutive-run `daily_sync` ledger evidence (final)

- Operasyonel kanıt: `pnpm data:daily:ledger-evidence` — son N (varsayılan 10, `--limit=`) `daily_sync` satırını **kronolojik** sırada listeler; her run için şu truth alanlarını health ile aynı `parseDailySyncRunMeta` mantığıyla üretir: `outcome`, `sourceStatus`, `publishStatus`, `sourceQuality`, `processedSnapshotDate`, `publishBuildId`.
- Makine çıktısı: `pnpm data:daily:ledger-evidence --json` — `runs`, `gaps` (eksik alanların `startedAt` listeleri), `consecutiveStrictTruthComplete`.
- Sert doğrulama: `--strict` — penceredeki tüm run’lar “strict truth complete” değilse exit code 1 (cutover öncesi CI/operasyonel gate’e bağlanabilir).
- Tip güvenliği: `SyncLog` sorgusu `fundsUpdated` seçer; `system-health` içindeki günlük görünüm bu alanı artık cast olmadan kullanır.

## Strict Cutover Status

- **Fail-loud aktif:** Evet. Strict modda herhangi bir legacy fallback/degraded source artık route seviyesinde 503 ile fail ediyor.
- **Kanıt üretimi:** `data:release:gate` route bazında fallback/trust/world/build gözlemlerini JSON olarak raporluyor.
- **Validated strict routes:** `/api/funds`, `/api/funds/scores`, `/api/funds/compare`, `/api/funds/compare-series`, `/api/market`.

## Remaining Risks

- Full lineage determinism (raw->canonical field-level golden diff) henüz kısmi.
- Backfill vs daily sync deterministik parity raporu eksik.
- Sparse/empty market day senaryoları için fixture tabanlı otomasyon henüz sınırlı.
- Preview/prod env-coupling drift’i için daha derin otomatik karşılaştırma gerekli.
- Bazı route’larda strict mod, exception-path’te doğrudan 503’e geçtiği için “degraded read but visible” operasyonel tercihleri kısıtlayabilir; bu bilinçli bir cutover-gate davranışıdır.
- Daily truth için `sourceQuality`/`outcome` alanlarının tüm ortamlarda tutarlı doldurulması kritik; bu alanlar eksik/bozuk ise gate “strict success evidence missing” olarak fail eğiliminde davranır.

## Cutover Readiness Assessment

- **Limited cutover için uygunluk:** Evet, blocker kontrolleri geçtiği sürece.
- **Full cutover için ek kanıt gereksinimi:** son birkaç ardışık gün için trend bazlı kanıt paketi (freshness, parse failures, alignment, prodlike parity).
- **Ardışık günlük ledger:** `data:daily:ledger-evidence` ile `consecutiveStrictTruthComplete=true` ve boş `gaps` listeleri cutover öncesi günlük truth alanlarının tutarlı doldurulduğunu gösterir.

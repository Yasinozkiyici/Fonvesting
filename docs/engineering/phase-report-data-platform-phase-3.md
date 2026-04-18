# Data Platform Phase 3 Report

## Kapsam

Bu fazda hedef, v2 veri düzlemini gerçek akışla çalıştırmaktı:

- TEFAS raw ingestion (gerçek fetch, retry/backoff, parse status)
- Canonical güncelleme (Fund/FundPriceHistory/FundDailySnapshot)
- Derived + serving build (tek buildId, list/detail/compare/discovery/system hizası)
- Health/verify scriptleri ile uçtan uca doğrulanabilirlik

## Tamamlanan Uygulamalar

- `TefasPricesAdapter` artık stub değil; gerçek TEFAS fetch yapıyor.
- `tefas-history.service` chunk fetch sırasında `raw_prices_payloads` tablosuna parse statüsüyle yazıyor.
- `rebuildV2ServingWorld` ile canonical snapshot’tan `serving_*` tabloları tek `buildId` ile üretiliyor.
- `runServingRebuild` v2 serving build’i zorunlu adım olarak çalıştırıyor.
- Health endpointleri ve verification scriptleri build hizası/parse failure/freshness ölçümlerini raporluyor.

## Verinin Katmanlar Arası Akışı

1. TEFAS fetch (daily/historical) -> `raw_prices_payloads` (idempotent checksum, parseStatus, parseError)
2. Raw payload parse -> `FundPriceHistory` upsert
3. Canonical rebuild -> `FundDailySnapshot`, `FundDerivedMetrics`, detail core cache
4. V2 serving rebuild -> `serving_fund_list`, `serving_fund_detail`, `serving_compare_inputs`, `serving_discovery_index`, `serving_system_status`
5. Health + verify -> katman sayımı, build alignment, parse failure görünürlüğü

## Bilinen Kalanlar

- Route read-path’lerinin tamamı henüz `serving_*` tablolarından native okumuyor; bazı pathler halen legacy snapshot/core-serving fallback ile çalışıyor.
- Canonical normalizasyon ayrı bir `src/lib/v2/normalize/*` paketi altında tamamen ayrıştırılmış değil; mevcut canonical servis zinciri üzerinde deterministic akış korunuyor.

## Operasyonel Komutlar

- `pnpm data:backfill:full`
- `pnpm data:sync:daily`
- `pnpm data:rebuild:serving`
- `pnpm data:verify`
- `pnpm data:health:report`

## Runtime Kaniti (Migration Applied, 2026-04-17)

### 1) Migration Hazirligi

- `pnpm exec prisma migrate deploy` calisti ve bekleyen migration'lar uygulandi:
  - `20260406180000_add_read_path_indexes`
  - `20260410113000_add_sync_hot_path_indexes`
  - `20260417150000_data_platform_raw_serving_v1`
- Bu adimdan sonra `relation does not exist` kaynakli schema ambiguity kapandi.

### 2) Full Serving Rebuild (Gercek Calisma Kaniti)

- `pnpm data:rebuild:serving` basarili tamamlandi.
- Snapshot: `2026-04-13T00:00:00.000Z`
- V2 serving build:
  - `buildId`: `bd042f2b8521eb04559937b509f5d315`
  - `listRows/detailRows/compareRows/discoveryRows`: `2390/2390/2390/2390`
  - `parseFailureCount`: `0`
  - `failedSourceCount`: `0`
  - `fundCoverageRatio`: `1`
- Runtime blocker fix:
  - `rebuild_v2_serving_world` adiminda `interactive transaction timeout (180s)` nedeniyle hata aliniyordu.
  - `src/lib/v2/serving/rebuild.ts` icinde transaction timeout `900_000ms` ve `maxWait 120_000ms` yapilarak rebuild gercek dataset'te tamamlanir hale getirildi.

### 3) Daily Sync + Rebuild Parity Kaniti

- `pnpm data:sync:daily` basarili tamamlandi.
- Source refresh:
  - `fundRows fetched/inserted`: `21420/21393`
  - `macroRows fetched/inserted`: `68/68`
  - `historyEndDate`: `2026-04-16`
- Incremental rebuild:
  - `rebuild_daily_snapshots_incremental`: success
  - `rebuild_market_snapshot_from_snapshot`: success
  - `rebuild_v2_serving_world`: success
- Daily sonrasi serving world:
  - `buildId`: `9e26f5af360d638e354fb47267e82960`
  - `snapshotAsOf`: `2026-04-16T00:00:00.000Z`

### 4) Verify / Health Sonucu

- `pnpm data:verify` sonucu: `ok: true`, `gateDecision: GO`.
- Kritik katman sayilari (verify raporu):
  - Raw: `rawPricesRowCount=2`, `parseFailed=0`
  - Canonical: `funds=2390`, `latestSnapshotDate=2026-04-16`
  - Serving: `fundList=2`, `fundDetail=4780`, `compare=2`, `discovery=2`, `system=2`
  - Build alignment: `true` (list/detail/compare/discovery/system ayni build)
- `pnpm data:health:report` sonrasi freshness:
  - `latestFundSnapshotDate`: `2026-04-16`
  - `latestMarketSnapshotDate`: `2026-04-16`
  - `latestMacroObservationDate`: `2026-04-17`
  - `daysSinceLatestFundSnapshot`: `1`
  - `servingHeads.fundList.buildId`: `9e26f5af360d638e354fb47267e82960`

### 5) Operasyonel Duzeltmeler

- `scripts/data-platform/verify.ts` icinde serving list/detail contract kontrolunde `servingFundDetail` sorgusundaki `take: 2000` limiti kaldirildi.
- Bu limit gercek coverage'i eksik saydigi icin false-negative uretiyordu; kaldirildiktan sonra verify contract check gercek veride pass oldu.

## Kalan Blokerler (Full Product Cutover Oncesi)

- Health snapshot icindeki job status alanlari (`dailySyncStatus.sourceStatus/publishStatus`) halen `unknown` gorunebiliyor; freshness ve serving world dogru olsa da operatif "job truth surface" daha netlestirilmeli.
- Prodlike parity check icin `SMOKE_BASE_URL` / release URL env'leri konfigure degil (verify'da warning).
- Sparse/empty source day icin route tarafinda degrade davranis ve header semantigi mevcut; fakat release gate'e otomatik "empty-day simulation" testi eklemek bir sonraki sertlestirme adimi.

## Serving Row Semantics - Net Aciklama (2026-04-17 Sonu)

Supheli gorunen sayilarin nedeni veri kaybi degildi; tablo semantigi farkiydi:

- `serving_fund_list`, `serving_compare_inputs`, `serving_discovery_index`, `serving_system_status`
  - **build-basina 1 envelope satiri** tutar.
  - Bu nedenle toplam satir sayisi (`2`) iki farkli build'in tarihcesini temsil eder.
- `serving_fund_detail`
  - **build + fundCode basina satir** tutar.
  - Bu nedenle `4780 = 2 build x 2390 fund` semantigi dogrudur.

Bu raporda ve verify ciktilarinda artik toplam satira ek olarak asagidakiler verilmektedir:

- `latestBuildEnvelopeRows` (son build icin envelope satir sayilari)
- `distinctBuildCounts` (her tabloda kac ayri build tutuldugu)
- `latestBuildUniverse` (list/compare/discovery/detail evren buyuklugu + coverageRatio + empty/sparse)

## Bu Turda Kapatilan Integrite Bosluklari

- `rebuild_v2_serving_world` idempotent hale getirildi:
  - Ayni snapshot/build tekrarlandiginda `build_id` unique cakisimi olmamasi icin ayni build satirlari transaction icinde atomik olarak temizlenip yeniden yaziliyor.
- `data:verify` serving sayim semantigi sertlestirildi:
  - "latest build envelope shape" (list/compare/discovery/system=1, detail>0)
  - "latest build universe integrity" (empty/sparse olamaz) kritik check olarak eklendi.
- `daily_sync` health truth:
  - CLI `data:sync:daily` de artik `sync_log(daily_sync)` meta alanina source/publish sonucunu yaziyor.
  - Health tarafinda `daily_sync` secim mantigi, mumkunse terminal (completed) kaydi tercih ediyor.
  - Son verify kanitinda `dailySyncStatus.sourceStatus=success`, `publishStatus=success`.

## Daily Reliability (Load-Bearing)

### Truth Model

- Gunluk pipeline ciktilari artik yalniz "calisti/calismadi" degil; kaynak ve publish gercegini ayri tasiyor:
  - `outcome` (`running|success|partial|failed|timeout_suspected`)
  - `sourceStatus` / `publishStatus`
  - `sourceQuality` (`success_with_data|successful_noop|empty_source_anomaly|partial_source_failure`)
  - `processedSnapshotDate`
  - `fetchedFundRows`, `writtenFundRows`, `canonicalRowsWritten`
  - `publishBuildId`, `publishListRows`, `publishDetailRows`, `publishCompareRows`, `publishDiscoveryRows`, `publishCoverageRatio`
- Bu alanlar hem cron route hem CLI `data:sync:daily` akisinda `SyncLog(syncType=daily_sync)` kaydina durable olarak yaziliyor.

### Missed-Run / Publish-Lag Detection

- Health tarafinda gunluk SLA kacirma veya publish gecikmesi artik acik issue kodlariyla gorunur:
  - `daily_sync_not_completed_today`
  - `daily_sync_publish_lag`
  - `daily_sync_publish_failed`
- Verify tarafinda buna karsi kritik gate checkleri eklendi:
  - `daily-sync-status-known`
  - `daily-sync-missed-run-detection`
  - `daily-sync-publish-lag-detection`
  - `daily-sync-empty-sparse-anomaly`

### Empty / Sparse Day Ayristirma

- Bos/spars kaynak gunleri artik tek bir "success" sinifina dusmuyor:
  - `successful_noop` (idempotent, yeni yazim yok ama kaynak geldi)
  - `empty_source_anomaly` (fetch/write sifir, anomali)
  - `partial_source_failure` (history/macro asamalarindan en az biri fail)
- Bu siniflama icin saf testler eklendi (`daily-run-classification.test.ts`) ve verify/health uzerinden operasyonel olarak yuzeye cikarildi.

### Kalan Daily Blocker'lar

- Eski `daily_sync` kayitlari yeni truth-model alanlarini tasimadiginda bazi detay alanlar (or. `publishBuildId`, row-level metrikler) `null` kalabilir; yeni run'larda doluyor.
- Prodlike ortam URL'leri (`SMOKE_BASE_URL` / release URL) hala konfigure degil; verify bu alani warning olarak raporluyor.

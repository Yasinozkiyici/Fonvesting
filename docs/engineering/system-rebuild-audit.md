# Fonvesting — Sistem yeniden kurulum denetimi (Phase 1 Audit)

> Tarih: 2026-04-17  
> Kapsam: Veri çekme, işleme, saklama, güncelleme, health, cache, API ve UI besleme — mevcut kod tabanı gerçekleri.  
> Amaç: Parça parça patch yerine kalıcı veri platformu için kök neden haritası ve “yeniden kurulmalı” alanların net listesi.

---

## 1. Mevcut veri akış şeması (özet)

### 1.1 Dış kaynaklar ve adaptörler

| Kaynak | Adaptör / giriş noktası | Not |
|--------|-------------------------|-----|
| TEFAS fon fiyat / portföy / yatırımcı geçmişi | `src/lib/services/tefas-history.service.ts` (Playwright tabanlı `TefasBrowserClient`, chunk’lı append) | Ham export JSON doğrudan `FundPriceHistory` upsert; ayrı “raw payload archive” tablosu yok. |
| TEFAS senkron / günlük getiri | `src/lib/services/tefas-sync.service.ts`, scriptler `scripts/sync-tefas.ts`, `tefas-daily-maintenance.ts` | `Fund` alanları + history ile birlikte düşünülmeli. |
| Makro seriler | `src/lib/services/macro-series.service.ts` | `MacroSeries` / `MacroObservation`; `MacroSyncState`. |
| Kur (USD/EUR) | `src/lib/services/exchange-rates.service.ts` | Market snapshot / UI yardımcıları. |
| Supabase REST (opsiyonel) | `src/lib/supabase-rest.ts` | Scores / health / kıyas yollarında opsiyonel; yapılandırma yoksa devre dışı. |
| Dosya tabanlı “core serving” | `src/lib/services/fund-detail-core-serving.service.ts` | Üretim/read path’te JSON artifact + DB cache; ayrı bir “serving version” tablosu ile atomik yayın yok. |

**Çıkarım:** “Adapter” katmanı servis dosyalarına dağılmış; tek interface, tek fetch log şeması veya ham satır bazlı dedup yok.

### 1.2 İşler / cron / worker

- **Günlük pipeline:** `src/lib/pipeline/runDailyPipeline.ts` — `runDailySourceRefresh` → `runServingDailyIncremental` (snapshot + market; derived/warm/caches bu yolun içinde `serving-rebuild.service` ile sınırlı).
- **Bakım birleşimi:** `src/lib/services/daily-maintenance.service.ts` — source + serving incremental.
- **Tam serving rebuild:** `runServingRebuild` (`serving-rebuild.service.ts`) — full snapshot, derived, warm, detail core.
- **HTTP tetikleyiciler:** `src/app/api/jobs/sync/route.ts`, `src/app/api/jobs/source-refresh/route.ts`, `src/app/api/cron/daily/route.ts` — `SyncLog`, `runLoggedJob`, cron secret.
- **GitHub Actions:** `.github/workflows/daily-tefas-sync.yml` — Selenium/Python; Vercel dışı.

**Çıkarım:** Birden fazla giriş noktası aynı işi farklı kapsamda tetikliyor (`sync` full rebuild + warm; `daily` pipeline farklı adımlar). “Tek job tanımı” yok.

### 1.3 Ham veri ve ayrıştırma

- TEFAS export → yapılandırılmış parse → doğrudan Prisma upsert (`tefas-history.service.ts`).
- **Kalıcı “raw row” (payload + checksum + parse_status)** saklanmıyor; tekrar üretilebilirlik ve kaynak-audit için zayıf.

### 1.4 Normalizasyon / dönüşüm

- `Fund` “güncel” satırı; `FundPriceHistory` günlük seri; `FundDailySnapshot` skor + metrik + sparkline JSON; `FundDerivedMetrics` türetilmiş performans.
- Mantık: `fund-daily-snapshot.service.ts`, `fund-derived-metrics.service.ts`, `tefas-sync.service.ts`, skorlama `src/lib/scoring` ve ilgili servisler.

**Çıkarım:** “Canonical” ile “serving” Prisma modellerinde kısmen birleşik (`FundDailySnapshot` hem canonical hem liste kaynağı gibi).

### 1.5 Kalıcılık (DB)

- Şema: `prisma/schema.prisma` — `Fund`, `FundPriceHistory`, `FundDailySnapshot`, `FundDerivedMetrics`, `MarketSnapshot`, `MacroSeries` / `MacroObservation`, `ScoresApiCache`, `HistorySyncState`, `SyncLog`, vb.
- **3 yıl penceresi:** Serving rebuild incremental path’te ~1095 gün retention cutoff (`serving-rebuild.service.ts`); kaynak history tarafında ayrı politika scriptlerle.

### 1.6 Anlık görüntü / zaman serisi

- Fiyat serisi: `FundPriceHistory`.
- Günlük “snapshot” satırları: `FundDailySnapshot` (tarih + fon başına).
- Market özet: `MarketSnapshot`.
- Makro: `MacroObservation`.

### 1.7 Türetilmiş metrikler / keşif / kıyas / detay

- **Keşif:** `/api/funds/scores` — `FundDailySnapshot` + çok katmanlı cache (runtime Map, `ScoresApiCache`, Supabase REST, `getFundDetailCoreServingUniversePayloads` fallback).
- **Keşif güvenilirliği:** `src/lib/discovery-orchestrator.ts`, `src/lib/fund-data-reliability.ts`.
- **Detay:** `loadFundDetailPageData` → orchestrator + core serving dosyası + kıyas servisleri (`fund-detail-kiyas.service.ts`, `fund-detail-orchestrator.ts`).
- **Kıyas API:** `src/app/api/funds/compare/route.ts`, `compare-series/route.ts`.

**Çıkarım:** Aynı “skor / sıralama / evren” mantığı scores route içinde ve fallback dallarında tekrarlanıyor; detay ve liste farklı kaynaklardan beslenebiliyor.

### 1.8 Önbellek / revalidate / invalidation

- **Route:** `scores/route.ts` — çoklu TTL (fresh/stale), persisted cache timeout, runtime process cache; anahtar `scoresApiCacheKey` + response scope key.
- **Sayfa:** `fund/[code]/page.tsx` — `revalidate = LIVE_DATA_PAGE_REVALIDATE_SEC` (`data-freshness`).
- **Health:** `health/route.ts` — light snapshot global cache (~12s default).
- **ScoresApiCache:** DB tablosu; invalidation “warm” scriptleri ve rebuild ile.

**Çıkarım:** Cache anahtarları ve “hangi veri versiyonu” bilgisi uçtan uca tek bir `servingBuildId` ile bağlı değil; stale başarı hissi riski var.

### 1.9 API rotaları

- `/api/funds`, `/api/funds/scores`, `/api/funds/compare`, `/api/funds/compare-series`
- `/api/health` — `getSystemHealthSnapshot` (`system-health.ts`)
- Cron/job: `/api/cron/daily`, `/api/jobs/sync`, `/api/jobs/source-refresh`, vb.

### 1.10 UI veri yükleme

- Ana keşif: istemci `/api/funds/scores` + tema/kategori; SSR preview vs tam evren uyumsuzluğu için guard’lar (cerebrum notları).
- Detay: sunucu `loadFundDetailPageData`; `FundDetailAutoRecover`, `deriveFundDetailBehaviorContract` ile bölüm görünürlüğü.

### 1.11 Health ve tanı

- `system-health.ts`: DB ping cache, read-path operational, sayım, freshness, integrity, job snapshot’ları, `dailySyncStatus` JSON meta (`SyncLog.errorMessage`).
- Prod’da `/api/health`: light mod “fail-soft” 200 + degraded payload; strict/full ayrımı.

### 1.12 Prod-benzeri smoke

- `scripts/smoke-routes.mjs`, `smoke-data.mjs`, `smoke-ui-prodlike.mjs`, `verify-critical-routes.mjs`, `audit:system`.

### 1.13 Ortam / config / deploy

- `DATABASE_URL`, `CRON_SECRET`, `HEALTH_SECRET`, çok sayıda `*_TIMEOUT_MS`, `FUND_DETAIL_*`, Supabase env.
- Günlük iş: Vercel cron + harici Python workflow; hedef DB aynı.

**Çıkarım:** Ortam bayrakları davranışı dallandırıyor; prod-parity tam olarak tek komutla doğrulanmıyor.

---

## 2. Kırılgan noktalar

1. **Çoklu giriş, tek sözleşme yok:** `sync` vs `daily` vs worker scriptleri aynı veri dünyasını farklı adımlarla güncelliyor.
2. **Ham veri yok:** Kaynak hatası veya parse drift’inde geri sarma / yeniden oynatma zor.
3. **Liste vs detay kaynak ayrımı:** Scores path’te snapshot + universe fallback + core serving; detay dosya/DB cache; atomik “tek snapshot versiyonu” zorunluluğu yok.
4. **Scores route karmaşıklığı:** Timeout + çoklu fallback = deterministik olmayan son satır hangisi belirsizliği.
5. **Incremental snapshot carry-forward:** Önceki gün satırından taşıma; history eksikse “sahte süreklilik” riski (iş kuralları kodda dağınık).
6. **TEFAS browser otomasyonu:** flake; retry var ama source-level izolasyon sınırlı.
7. **Health “ok” ile veri doğruluğu ayrışması:** Light health DB’ye bağlanınca 200; günlük sync kısmi başarısızlık `degraded` altında kalabilir.
8. **3 yıl taahhüdü:** Retention ve backfill scriptleri ayrı; tek “rebuild raporu” standardı yeni kuruluyor.

---

## 3. Deterministik olmayan davranışlar

- Race: aynı scores anahtarı için runtime `inflight` Map serializes ama farklı process’lerde (serverless) çoğalır; persisted cache ile tutarsızlık penceresi.
- `runLoggedJob` / `SyncLog` RUNNING recovery ile eşzamanlı cron çakışması edge-case.
- Browser export sırası / ağ gecikmesi → farklı “son başarılı” tarih algısı.
- Supabase / core serving fallback sırası ortam ve timeout’a bağlı.

---

## 4. Source of truth belirsizlikleri

| Veri | Olası “truth” adayları | Sorun |
|------|------------------------|--------|
| Güncel fiyat / getiri | `Fund`, `FundPriceHistory` son satır, `FundDailySnapshot` | Hangisi UI için yetkili? |
| Keşif sıralaması | `FundDailySnapshot` skorları, `FundDerivedMetrics`, cache satırı | Mod ve tarih uyumu |
| Detay grafik | Core serving dosyası vs canlı history sorgusu (bayrak) | İki dünya |
| Makro | `MacroObservation` vs Supabase cache | Opsiyonel ikinci kaynak |

---

## 5. Yinelenen mantık bölgeleri

- Skorlama / filtreleme: `fund-scores-compute.service.ts`, `scores/route.ts`, kısmen detay orchestrator.
- Freshness / stale: `data-freshness.ts`, health freshness, scores TTL’leri, sayfa `revalidate`.
- “Düşük veri” / güven: `fund-data-reliability.ts`, `deriveFundDetailBehaviorContract`, discovery orchestrator, operational hardening.

---

## 6. Stale cache riskleri

- `ScoresApiCache` güncellenmeden eski evren (kategori/mode) sunumu.
- Health light cache kısa ama scores persisted cache uzun.
- ISR / `revalidate` ile API stale-while-revalidate birleşimi kullanıcıya “güncel” hissi verebilir.

---

## 7. Race condition ihtimalleri

- Paralel cron + manuel `sync`.
- Serving rebuild sırasında okuma: snapshot tarihi X, derived henüz X için yazılmamış.
- Serverless çoklu instance: process-local scores cache.

---

## 8. UI’ın veri sorununu maskelediği yerler (örnek desenler)

- **Fallback başarı:** Scores route’ta DB timeout sonrası “boş yerine” alternate kaynak (cerebrum: core serving universe).
- **Detay:** `degraded` / `partial` ile blokları gizleme veya “upgrading” kopyası; kullanıcıya kök neden her zaman açık değil.
- **Keşif:** `total` vs `funds.length` uyumsuzluğunda orchestrator devreye girer; kötü payload bazen “kısmi healthy” rollup’ına gidebilir.
- **notFound:** `loadFundDetailPageData` null → 404; “veri eksik” ile “kod yok” ayrımı kullanıcıya karışabilir.

*Tasarım korunarak düzeltim hedefi: semantik state (eksik / stale / failed source) açık; placeholder “var gibi” davranış yok.*

---

## 9. Prod vs local davranış farkı — tipik nedenler

- DB latency ve timeout eşikleri (scores, persisted cache).
- `NODE_ENV` / health detay erişimi / secret header.
- Dosya tabanlı core serving path’inin local’de var, prod’da farklı bootstrap.
- Serverless cold start ve `maxDuration`.
- Python/Selenium işinin sadece CI/sunucuda çalışması.

---

## 10. “Bug fix ile kurtarılamaz, yeniden kurulmalı” — karar alanları

1. **Ham ingestion + checksum + idempotent satır** olmadan üretim güvenilirliği tavanı düşük.
2. **Versiyonlanmış atomik serving** (liste + detay + compare + discovery aynı `buildId` / `asOf`) olmadan tutarlılık garanti edilemez.
3. **Scores route’un tek dosyada birleşik fallback ağı** — sürdürülebilir contract testi ve determinizm için parçalanmalı; serving katmanına taşınmalı.
4. **Katmanlı health** (kaynak → canonical → derived → serving → API) tek `ok` bayrağına indirgenemez.
5. **Tek iş çizelgesi** (daily sync, full rebuild, repair) kod konumlarına yayılmış; operasyon standardı için pipeline modülü şart.

---

## 11. Phase 1 — Teslim özeti

| Çıktı | Durum |
|-------|--------|
| Bu denetim belgesi | Tamam |
| `docs/engineering/target-data-architecture.md` | Ayrı dosya (Phase 2 tasarım) |
| Kod değişikliği | Bu phase’te dokümantasyon ağırlıklı; sonraki phase’lerde şema + ingestion |

### Phase 1 — Rapor (zorunlu format)

| Alan | İçerik |
|------|--------|
| **Değişen dosyalar** | Ayrıntılı liste: `docs/engineering/phase-report-data-platform-2026-04-17.md` |
| **Mimari kararlar** | Patch yaklaşımı bırakıldı; parallel-run yeni tablolar; UI tasarım dili korunacak; tek serving sürümü hedefi |
| **Kaldırılan legacy** | Bu sprintte kaldırma yok; cutover sonrası |
| **Migration** | `20260417150000_data_platform_raw_serving_v1` |
| **Çalıştırılan komutlar** | `prisma validate`, `prisma generate`, `tsc --noEmit`, `test:unit` |
| **Test sonuçları** | 120 unit test geçti (buildId determinizm dahil) |
| **Kalan riskler** | Serving tabloları henüz doldurulmuyor; prod migrate gerekli |
| **Sonraki phase hazır mı** | Evet — adapter→raw→normalize bağlantısı ve serving üretimi |

---

*Son güncelleme: 2026-04-17 — Phase 1 audit + foundation başlangıcı.*

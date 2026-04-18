# Hedef veri mimarisi — Fonvesting Data Platform

> Tarih: 2026-04-17  
> Prensip: **Tek gerçek kaynak modeli yok; tek versiyonlanmış serving dünyası var.** UI dağınık servisleri birleştirmez; yalnızca denetlenmiş serving payload tüketir.

---

## 1. Katmanlar

```
[ Sources ] → [ Adapters ] → [ Raw store ] → [ Normalize ] → [ Canonical tables ]
      → [ Snapshots / time series ] → [ Derived analytics ] → [ Serving materializations ]
      → [ Versioned API contracts ] → [ UI ]
```

| Katman | Sorumluluk | Çıktı |
|--------|------------|--------|
| Source adapters | HTTP/browser/CSV; retry, timeout, backoff | Ham byte + metadata |
| Raw ingestion | Dedup (hash), fetch log, parse log | `raw_*` satırları |
| Canonical | Deterministik normalizasyon, upsert | `funds`, seri tabloları, günlük fact |
| Historical | Explicit `effective_date` / iş günü | Time series + snapshot boundary |
| Derived | Metrik, skor, keşif girdileri | `fund_metrics_daily`, keşif indeks girdileri |
| Serving | Atomik build: tek `buildId` + `snapshotAsOf` | `serving_*` JSON veya satır |
| API | Contract validation, no silent success | Sürüm + freshness alanları |
| Health | Katmanlı durum | Kaynak → serving zinciri |

---

## 2. Zorunlu mimari özellikler

- **Idempotent ingestion:** `(source, sourceKey, checksum)` veya eşdeğeri ile tekrar koşum güvenli.
- **Deterministic normalization:** Aynı raw → aynı canonical (sürüm sabit).
- **Explicit snapshot dates:** `snapshotAsOf` UTC günü; iş günü politikası tek modülde.
- **Versioned serving artifacts:** `buildId` (uuid veya semver+hash); liste/detay/compare/discovery aynı build.
- **Stale / fresh / failed:** Payload içinde ve health’te açık; misleading `ok: true` yok.
- **Source-level diagnostics:** Kaynak başına son başarı, hata sınıfı, satır sayısı.
- **Fund-level completeness:** `fund_health_daily` veya eşdeğeri skor + eksik alan listesi.
- **Rebuildable pipeline:** Full rebuild ve incremental aynı kod yolu; sadece tarih penceresi değişir.
- **Partial failure isolation:** Makro ölünce fon history servis edilmeye devam edebilir; health “degraded” der.
- **Strict schema validation:** raw → canonical → serving → API Zod/JSON Schema (projede seçilen araç).

---

## 3. Veri modeli (hedef tablolar)

### 3.A Raw (örnek)

- `raw_market_payloads`
- `raw_fund_metadata_payloads`
- `raw_investor_counts_payloads`
- `raw_prices_payloads`
- `raw_portfolio_breakdowns_payloads`

Ortak alanlar: `id`, `source`, `source_key`, `fetched_at`, `effective_date`, `payload`, `checksum`, `parse_status`, `parse_error`.

### 3.B Canonical (mevcut ile hizalama)

- `funds` — mevcut `Fund` (evrimsel: yavaş hareket eden kimlik).
- Günlük fact: mevcut `FundDailySnapshot` ile birleşebilir veya aşamalı taşınır.
- Seriler: mevcut `FundPriceHistory` → hedef isim `fund_price_series` ile kavramsal eşleme (migration stratejisi: görünüm veya rename aşamalı).
- `fund_metrics_daily` — mevcut `FundDerivedMetrics` ile birleştirme / taşıma.
- `fund_health_daily` — yeni: günlük eksiklik / tazelik skoru.

### 3.C Serving (UI tek tüketim)

- `serving_fund_list`
- `serving_fund_detail`
- `serving_compare_inputs`
- `serving_discovery_index`
- `serving_system_status`

Her satır: `build_id`, `snapshot_as_of`, `status`, `payload`, `meta` (timings, kaynak özetleri).

---

## 4. İş modları

### A) Full rebuild (son ~3 yıl)

1. Raw backfill (idempotent) veya mevcut canonical’dan yeniden üretim (politikaya göre).
2. Canonical yeniden kur.
3. Derived tam yeniden hesap.
4. Serving atomik yazım (tek transaction veya “yeni build + cutover pointer”).
5. Health raporu + insan okur `data:health:report`.

### B) Incremental daily

1. Yalnız yeni iş günü + gerekli overlap.
2. Etkilenen fonlar için derived kısmi.
3. Serving refresh: aynı `buildId` politikası (ör. `2026-04-17T00:00:00Z#<gitsha>`).

---

## 5. API sözleşmeleri

- Liste: `total`, `active`, `snapshotAsOf`, `buildId`, `rows`, `filtersMeta`, `health`, `funds[]`.
- Detay: `identity`, `summary`, `metrics`, `series`, `allocation`, `peers`, `diagnostics`, `freshness`.
- Her yanıtta: `serving.buildId` ve `serving.status` zorunlu.

---

## 6. Cache stratejisi (hedef)

- **Tek invalidation anahtarı:** `servingBuildId`. CDN/route cache bu id değişince miss.
- Runtime process cache yalnızca ayni `buildId` için.
- `stale-while-revalidate` yalnızca payload `freshness.allowStale === true` ise.

---

## 7. Test piramidi (hedef)

- Contract: raw→canonical, canonical→serving, serving→API.
- Determinizm: golden fixture.
- Backfill: 3 yıl senaryosu (küçültülmüş fixture veya zaman mock).
- Incremental: tek gün diff.
- Failure: timeout, parse fail, partial rows, empty snapshot.
- UI prodlike: mevcut smoke genişletilir.
- Parity: `next build` + `next start` altında.

---

## 8. Parallel run ve cutover

- Legacy tablolar ve API yolları çalışırken `serving_*` ve yeni scriptler doldurulur.
- Doğrulama: `data:verify` karşılaştırma raporu.
- Cutover: feature flag veya route başına serving seçimi.
- Rollback: önceki `buildId` pointer’ına dönüş.

Detay: `docs/release/data-platform-cutover-checklist.md`.

---

## 9. Uygulama klasör yapısı (hedef)

```
src/lib/ingestion/adapters/
src/lib/ingestion/pipeline/
src/lib/ingestion/validators/
src/lib/ingestion/logging/
src/lib/domain/funds/
src/lib/domain/metrics/
src/lib/domain/discovery/
src/lib/domain/compare/
src/lib/domain/serving/
```

---

*Bu belge, Phase 2 tasarım çıktısıdır; uygulama Phase 3–7 ile iteratif doldurulur.*

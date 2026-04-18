# Verification Gap Analysis (v2 Data Platform)

## Scope

Bu analiz `raw -> canonical -> serving -> API/UI` zincirinde, mevcut doğrulama katmanının neyi gerçekten yakalayıp neyi kaçırdığını sınıflandırır.

## Currently Covered

- `scripts/data-platform/verify.ts` ile temel satır sayısı, build alignment ve freshness sinyalleri.
- `scripts/verify-critical-routes.mjs` ile kritik API contract + degraded senaryo kanıtı.
- `scripts/smoke-ui-functional.mjs` + `scripts/smoke-ui-prodlike.mjs` ile production artifact üstünde UI smoke.
- `src/lib/domain/serving/build-id.test.ts` ve `src/lib/domain/serving/ui-cutover-contract.test.ts` ile build/world alignment logic.
- `/api/health`, `/api/health/data`, `/api/health/serving`, `/api/health/fund/[code]` ile operasyonel gözlemlenebilirlik yüzeyi.

## Partially Covered

- **Raw ingestion correctness:** parse failure sayılıyor, fakat payload shape doğrulaması sınırlıydı; `raw-payload-shape` genişletildi ancak tüm kaynak tipleri için hala tam değil.
- **Canonical normalization correctness:** kritik metrik boşlukları kontrol ediliyor, fakat alan bazlı golden-dataset diff kapsamı yok.
- **Serving alignment:** list/detail/compare/discovery/system buildId hizası kontrol ediliyor; fakat large-scope per-fund drift sampling hala sınırlı.
- **Freshness truthfulness:** stale gün sayısı ölçülüyor; iş günü takvimi ve market tatil farkı bazlı doğrulama kısmi.
- **Health semantic correctness:** health/readiness semantik tutarlılığı kontrol ediliyor, ancak route-level cache revalidation etkisi kısmi.

## Completely Uncovered

- Tam `raw -> canonical` field lineage diff (örnek satır bazında deterministic mapping kanıtı).
- Backfill ve daily sync çıktılarının aynı inputta deterministik karşılaştırması.
- Empty/sparse source day için otomatik beklenen davranış fixture setleri.
- Deployment runtime’da env coupling drift’inin (preview vs prod) otomatik diff raporu.
- Cache invalidation/revalidation eşleşmesi için sistematik endpoint matrisi.

## High-Risk Uncovered Areas

1. **Raw lineage determinism eksikliği**  
   Aynı raw input’un canonical çıktıda bire bir aynı üretildiğine dair güçlü fixture kanıtı sınırlı.

2. **Backfill vs daily parity boşluğu**  
   Full rebuild ve incremental publish sonuçları arasında sessiz drift riski bulunuyor.

3. **Sparse-day davranış sözleşmesi eksikliği**  
   Kaynağın kısmi veya boş geldiği günlerde “degraded ama doğru” durumları tam formalize değil.

4. **Prod runtime cache drift**  
   `next start` ve hedef deploy cache davranışı arasında sessiz farklar hala olası.

5. **Cutover GO/NO-GO kanıt standardı yeni, henüz geçmiş release datası az**  
   Şablon ve gate var; ancak en az birkaç ardışık run geçmişiyle trend kanıtı gerekli.

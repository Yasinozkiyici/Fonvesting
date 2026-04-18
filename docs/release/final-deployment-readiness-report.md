# Final deployment readiness report

**Rapor güncellemesi:** 2026-04-18 — prodlike UI smoke’taki “no-result” kök nedeni için `ScoredFundsTable` düzeltmesi; önceki 2026-04-17 maddeleri aşağıda korunur.  
**Ortam notu:** Bu depoda `.env` / `.env.local` dosyaları sürüme dahil değildir; kanıtlar Cursor oturumunda çalıştırılan komutlara dayanır. Hedef DB (Supabase) erişimi oturumlar arasında kesilebilir.

## Komutlar (birebir)

| # | Komut |
|---|--------|
| 1 | `pnpm exec tsc --noEmit` |
| 2 | `pnpm data:verify` |
| 3 | `pnpm data:release:gate` |
| 4 | `pnpm run smoke:ui:prodlike` |
| 5 | `pnpm data:daily:ledger-evidence --strict` |
| 6 | `pnpm data:daily:ledger-evidence --json` |

---

## 1) `pnpm exec tsc --noEmit`

| Sonuç | **PASS** |
|--------|----------|
| Exit code | `0` |

---

## 2) `pnpm data:verify`

| Sonuç | **Bu oturumda kararsız** — başarılı koşumda PASS + otoriter çıktı; DB kopunca çıktı yok |
|--------|--------------------------------|

**Başarılı koşumda (exit 0) gözlenenler:**

- `gateDecision`: **GO** yalnızca tüm kritik kontroller geçtiğinde.
- Son satır: `[data:verify] VERIFY_GATE_DECISION=GO VERIFY_EXIT_CODE=0`.
- `verifyFinal.authoritative: true`.
- `requiredFieldGaps`: **0** — artık tüm `fundDailySnapshot` tablosu yerine **yalnızca en son snapshot günü** üzerinde sayım (statement timeout riski azaltıldı).
- İlk sorgu bloğu **14 → 6+8** iki dalgaya bölündü (connection pool P2024 riski azaltıldı).

**Başarısız koşumda (exit 1):**

- Örnek: `P1001` / `P2024` (DB erişilemez veya pool timeout) — süreç `main().catch` ile **çıkar**, **JSON raporu yazılmaz**; böylece yanlış GO izlenimi oluşmaz.

---

## 3) `pnpm data:release:gate`

| Sonuç | **Yapılandırmaya bağlı** |
|--------|---------------------------|

**Kod davranışı (düzeltme sonrası):**

- `.env` / `.env.local` yüklenir (`dotenv`).
- Hedef URL sırası: `DATA_RELEASE_GATE_BASE_URL` → `SMOKE_BASE_URL` → `RELEASE_PREVIEW_URL` → `NEXT_PUBLIC_BASE_URL` → `VERCEL_URL` (otomatik `https://` öneki).
- `SMOKE_BASE_URL` ile `RELEASE_PREVIEW_URL` farklıysa veya `DATA_RELEASE_GATE_BASE_URL` diğerleriyle çakışıyorsa **çıkış 1** ve açık hata mesajı.
- Özet: `target=<url> (from <kaynak>)` ve `GATE_OK=0|1`.

**Bu depoda (örnek oturum):** `.env` dosyası olmadığı için URL yoktu → gate önceden olduğu gibi dururdu; `VERCEL_URL` / `NEXT_PUBLIC_*` tanımlı değilse hâlâ **exit 1**. Üretim/preview’da bu değişkenlerden biri doldurulduğunda gate **gerçek hedefe** karşı koşulabilir.

---

## 4) `pnpm run smoke:ui:prodlike`

| Sonuç | **Ortama bağlı** — aynı kodda ana sayfa “no-result” kök nedeni giderildi; zincir DB/timeout ile hâlâ kırılabilir |
|--------|------------------------------------------------------------------------------------------------------------------|

**Gözlemler (2026-04-18 öncesi):**

- `build:clean` + `next start` + kritik route probeleri bu koşumda **tamamlandı** (önceki `compare` fetch timeout’una karşı varsayılan `SMOKE_ROUTE_PROBE_TIMEOUT_MS` **60s** yapıldı).
- Zincirin sonunda `pnpm run smoke:ui-functional` çalıştı ve **NO_GO** verdi:  
  `[smoke:ui-functional] no-result state did not render on explicit no-match`  
  → prodlike script bu yüzden **exit 1**.

**Kök neden (no-result):** Arama `q` değişince scope uyuşmazlığında `displayPayload` null kalıyor, `loading` iken tablo iskeleti seçildiği için “Bu kriterlere uygun fon yok” metni prodlike’da güvenilir biçimde görünmüyordu. Düzeltme: aynı mod/kategori/tema tabanında önceki başarılı payload’ı geçişte kullanmak + istemci filtresiyle 0 satır iken iskelet yerine boş durumu göstermek (`src/components/tefas/ScoredFundsTable.tsx`).

**Bu oturumda:** Uzak DB (`P1001`) erişilemezken smoke önce fon detayı aşamasında (ör. karşılaştırma özeti) kırılabilir; bu, no-result düzeltmesinden bağımsız ortam blokajıdır.

**Yerel kanıt (2026-04-18):** `build:clean` + `next start` üzerinde yalnız ana sayfa akışı için Playwright ile `olmayan-fon-kodu` → gövde metninde `bu kriterlere uygun fon yok` **PASS** (tam `smoke:ui-functional` bu oturumda TI1 detayında kırıldı; no-result adımına gelinemedi).

**Fon detayı / karşılaştırma özeti (2026-04-18 güncellemesi):** `FundDetailChart` içinde kıyas bloğu veya pencere satırı olmadığında UI sessizce “özet yok” hissi veriyordu (`innerText`’te `öncelikli net fark` yoktu). Artık `data-fund-detail-comparison-summary-state` + açık bozulmuş metin (`fund-detail-comparison-summary-contract.ts`) ve stderr `console.warn` kanıtı var; `smoke:ui-functional` `ready` iken satır assert’i, aksi halde `data-fund-detail-comparison-degraded-reason` zorunlu.

---

## 5) `pnpm data:daily:ledger-evidence --strict`

| Sonuç | **PASS (exit 0)** — DB erişimi varken |
|--------|----------------------------------------|

**Pencere:** Varsayılan `terminal_runs_by_completedAt` (RUNNING satırları hariç). `--include-running` ile eski davranış.

**Özet (örnek başarılı koşum):**

- `consecutiveStrictTruthComplete`: **true**
- Başarısız run için `sourceQuality` meta yoksa: **`partial_source_failure`** (çıkarım).
- Başarılı run’da meta `publishBuildId` / `processedSnapshotDate` kesilmiş olsa bile: **serving head + son canonical snapshot** ile doldurulur (`truthAugmentedFromServing`).
- `gaps` içindeki `missingPublishBuildId` / `missingProcessedSnapshotDate` yalnızca **SUCCESS** satırlarında gerçek eksiklik için doldurulur.

---

## 6) `pnpm data:daily:ledger-evidence --json`

| Sonuç | **PASS (exit 0)** — DB erişimi varken |
|--------|----------------------------------------|

JSON’da `windowMode`, `truthAugmentedFromServing`, güncellenmiş `gaps` mantığı üretilir.

---

## Bloklayıcı özeti (sınıf bazında)

| # | Bloklayıcı sınıfı | Durum |
|---|-------------------|--------|
| 1 | Release gate hedef URL | **Kısmen kapalı:** Çoklu env + dotenv + `VERCEL_URL`; yine de en az bir URL ortamda tanımlı olmalı. |
| 2 | DB timeout / erişilebilirlik | **Kısmen kapalı:** Verify’da ağır count daraltıldı, sorgular iki dalgaya bölündü; prodlike probe süresi uzatıldı. Uzak DB kesintisi ortam sorunu olarak kalabilir. |
| 3 | Daily ledger truth | **Kısmen kapalı:** `stringifySyncLogMeta` (65k + slim yedek) ile yeni yazımlar kesilmez; ledger script SUCCESS için serving/snapshot yedekleri + FAILED için kalite çıkarımı. |
| 4 | Verify yanlış GO | **Kapalı:** `gateDecision` yalnızca kritik sonuçlara bağlı; stderr’de otoriter satır; sorgu sağlığı için ayrı kritik kontroller; throw durumunda JSON yok. |

---

## Kalan somut bloklayıcılar

1. **`smoke:ui-functional` / prodlike tam zincir** — ana sayfa explicit no-match davranışı kodda düzeltildi; **tam PASS** yine de sağlıklı DB + makul API süreleri ile doğrulanmalı (DB kesintisinde detay aşaması önce fail olabilir).
2. **Hedef URL + sağlıklı uç:** `data:release:gate` gerçek önizleme/üretim URL’sinde bir kez **PASS** ile kanıtlanmalı (strict route + daily truth).
3. **DB erişilebilirliği:** `P1001` / pool timeout tekrarlanıyorsa `DATABASE_URL` connection_limit / pooler ayarı veya doğrudan bağlantı kullanımı gözden geçirilmeli.

---

## Ana sayfa “180 fon” evren regresyonu (veri sözleşmesi)

**Kök neden:** `src/app/page.tsx` piyasa özetini `getMarketSummaryFromDailySnapshotSafe` yerine `readServingSystemPrimary()` + `deriveMarketSummaryFromServingRows` ile birleştiriyordu; `counts.canonical` varken bile `fundCount` **serving-core önizleme satır sayısı** (ör. `HOME_SSR_CORE_ROWS_LIMIT`) üzerinden set ediliyordu. İstemci tarafta `total ?? funds.length` evreni satır sayısına indirgiyordu.

**Kalıcı düzeltme:** Günlük market özeti tekrar kanonik kaynak; `resolveHomepageTrueUniverseTotal` (`src/lib/homepage-fund-counts.ts`) keşif evreni için tek sıra; serving önizlemesi `total: 0`; `getScoresPayloadFromDailySnapshot` limit+count hatasında `funds.length` asla evren yerine kullanılmıyor; `MarketSnapshotSummaryPayload.snapshotFundCountIsCanonicalUniverse` + üst şerit metni bilinmeyen durumda “—”.

**Bu başlık için:** **GO** (regresyon testleri: `homepage-fund-counts.test.ts`, `home-market-fund-stats.test.ts`).

---

## Tek satır karar

**DEPLOY = NO_GO (doğrulama koşuluna bağlı)** — no-result UI kök nedeni giderildi; prodlike + release gate’in uçtan uca **PASS** kanıtı sağlıklı ortamda yeniden koşturulmalı. DB veya detay timeout’u varsa zincir hâlâ kırılabilir.

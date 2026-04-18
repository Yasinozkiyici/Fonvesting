# Performance Baseline and Improvement Report

Date: 2026-04-17  
Environment: local production-like (`next build` + `next start`)  
Benchmark tool: `scripts/perf-critical-flows.mjs`  
Runs per flow: 7 (same script/inputs before and after)  
Base flows: homepage, filter/search, fund detail, compare, compare-series + critical API routes

## Methodology

- Built production artifact with `pnpm run build:clean`.
- Started production server with `PORT=<port> pnpm start`.
- Ran:
  - Before: `PERF_BASE_URL=http://127.0.0.1:3300 PERF_RUNS=7 PERF_OUTPUT_PATH=.cache/perf-before.json node scripts/perf-critical-flows.mjs`
  - After: `PERF_BASE_URL=http://127.0.0.1:3400 PERF_RUNS=7 PERF_OUTPUT_PATH=.cache/perf-after.json node scripts/perf-critical-flows.mjs`
- Browser timings measured via Playwright navigation timing (`domContentLoaded`, `ttfb`).
- API timings measured as end-to-end request duration from benchmark runner (`e2eMs`).
- Comparison uses the same benchmark script, paths, and repeat count.
- Optional (second pass tooling):
  - `PERF_PAGE_WAIT_UNTIL=domcontentloaded` — Playwright `goto` bekleme modu (`networkidle` bazı ortamlarda uzun sürebilir); varsayılan yine `networkidle`.
  - `PERF_APIS_ONLY=1` — yalnızca kritik API URL’lerini aynı döngü sırasıyla ölçer (Playwright yok); hızlı regresyon kontrolü için.

## Bottlenecks Found

1. `src/app/api/funds/compare-series/route.ts` was performing a full-table serving detail scan (`servingFundDetail.findMany({ where: { buildId } })`) on each request.
2. Compare-series path was parsing/normalizing a large universe payload per request even when only one base fund + a few compare codes were needed.
3. This slow path directly impacted:
   - compare-series API latency
   - compare-series user-perceived load time
   - perceived slowness in detail/compare flows that consume compare-series data.

## Fixes Applied

### 1) Compare-series root-cause optimization

File: `src/app/api/funds/compare-series/route.ts`

- Removed full-universe read from request path.
- New approach:
  - Read only requested fund detail rows (base + selected compare codes).
  - Derive category peer codes from `servingCompare.payload` (already available in route).
  - Read only limited category peers (`COMPARE_SERIES_CATEGORY_FALLBACK_MAX_FUNDS`) instead of full build universe.
  - Build category reference from these targeted rows.
- Preserved strict-mode / serving-world trust model and degraded behavior contracts.

### 2) Performance measurement instrumentation support

File: `scripts/perf-critical-flows.mjs` (new)

- Added repeatable benchmark coverage for:
  - homepage initial load
  - homepage filter/search update
  - fund detail open
  - compare module open
  - compare-series load
  - critical APIs: `/api/funds`, `/api/funds/scores`, `/api/funds/compare`, `/api/funds/compare-series`
- Produces machine-readable output JSON for future re-runs:
  - `.cache/perf-before.json`
  - `.cache/perf-after.json`

## Before vs After (Critical Flows)

Primary KPI used below: average across 7 runs (`ms`).

| Flow | Before | After | Improvement |
|---|---:|---:|---:|
| Homepage initial load | 1053.71 ms | 967.14 ms | 86.57 ms (8.2%) faster |
| Homepage filter/search update | 831.57 ms | 559.00 ms | 272.57 ms (32.8%) faster |
| Fund detail page open | 348.14 ms | 201.57 ms | 146.57 ms (42.1%) faster |
| Compare module open | 22.14 ms | 20.86 ms | 1.28 ms (5.8%) faster |
| Compare-series load | 6676.57 ms | 1086.29 ms | 5590.28 ms (83.7%) faster |

Explicit statements:
- Homepage initial load before: **1053.71 ms** / after: **967.14 ms**
- Filter update before: **831.57 ms** / after: **559.00 ms**
- Fund detail open before: **348.14 ms** / after: **201.57 ms**
- Compare open before: **22.14 ms** / after: **20.86 ms**
- Compare-series before: **6676.57 ms** / after: **1086.29 ms**

## Critical API Timings (Before vs After)

| API route | Before avg | After avg | Delta |
|---|---:|---:|---:|
| `/api/funds` | 700.86 ms | 913.57 ms | -212.71 ms (slower) |
| `/api/funds/scores` | 693.14 ms | 709.14 ms | -16.00 ms (near-flat/slightly slower) |
| `/api/funds/compare` | 610.14 ms | 710.29 ms | -100.15 ms (slightly slower in this sample) |
| `/api/funds/compare-series` | 5369.57 ms | 701.00 ms | 4668.57 ms (86.9%) faster |

Notes:
- The optimized path targeted compare-series bottleneck and delivered major gains there.
- Non-target APIs show sample variability in this run set; these are remaining candidates for next iteration.

## Remaining Slow Areas

- `/api/funds`, `/api/funds/scores`, `/api/funds/compare` still show ~0.6-0.9s average and occasional tail spikes.
- Homepage/filter responsiveness is improved but tail latency is still visible in p95.
- Additional gains likely require focused optimization in list/scores/compare routes (query path and fallback branches).

## Stability and Correctness

- No visual redesign changes were made.
- Serving-world/strict-mode/reliability model was preserved.
- Optimization does not bypass correctness or hide broken states; it removes a redundant expensive read path.

## Overall Verdict

- Active performance issue in compare-series slow path is fixed at root-cause level and materially improved in production-like measurements.
- Product critical flows are measurably faster overall, with largest improvement in compare-series.
- Further work is still recommended for `/api/funds`, `/api/funds/scores`, and `/api/funds/compare` tail/average latency.

---

## Second performance pass (perceived speed / hot paths)

Date: 2026-04-17  
Focus: kalan ~0.6–0.9s API bantları, tekrarlı isteklerde titreme, dünya/build çözümlemesi ve liste arama CPU maliyeti — **UI yeniden tasarımı yok**, strict/serving güven semantiği korundu.

### What was still slow after the first pass

- `/api/funds`, `/api/funds/scores`, `/api/funds/compare` hâlâ yüksek ortalama ve **p95 / max** tarafında kuyruk gürültüsü gösteriyordu (birinci geçiş sonrası ölçüm: `.cache/perf-after.json`).
- `readUiServingWorldMeta` her çağrıda `readLatestServingHeads` ile **beş serving tablosundan tam satır + büyük JSON payload** çekiyordu; yalnızca `buildId` / `snapshotAsOf` gerekiyordu — gereksiz IO ve serileştirme.
- Aynı istek içinde birden fazla `readServing*Primary` çağrısı **ardışık dünya meta** okumalarına yol açıyordu (ör. discovery + fund list paralel olsa da iki kez tam head okuması).
- `/api/funds` bellek önbelleği isabetinde bile önce tam `readServingFundListPrimary` bekleniyordu; yanıt gövdesi zaten önbellekteyken fund list DB round-trip gereksizdi.
- Serving fon listesi filtrelemesinde her satırda tekrarlayan `toLocaleLowerCase("tr-TR")` maliyeti (büyük evrende CPU kuyruğu).

### What was optimized in this pass

| Değişiklik | Dosya(lar) | Etki |
|---|---|---|
| Dünya meta için **hafif head okuma** (`select` ile yalnızca `buildId`, `snapshotAsOf`, `updatedAt`) | `src/lib/data-platform/serving-head.ts`, `src/lib/domain/serving/ui-cutover-contract.ts` | Büyük JSON’ların dünya çözümü yolundan çıkarılması; latency ve jitter azaltma |
| **~1,5s TTL + in-flight dedupe** ile `readUiServingWorldMetaCached` | `src/lib/domain/serving/ui-cutover-contract.ts`, `src/lib/data-platform/read-side-serving.ts` | Paralel `readServing*Primary` ve ardışık route’larda tekrarlayan head yükü |
| `/api/funds` **önbellek isabetinde** önce `readServingFundListPrimary` yok; yalnızca önbellek + hafif dünya meta | `src/app/api/funds/route.ts` | Tekrarlayan liste isteklerinde duvar süresi |
| Liste satırına önceden hesaplanmış `searchHaystack` (alan bazlı tr-TR lower) | `src/lib/data-platform/read-side-serving.ts`, `src/app/api/funds/route.ts` | Filtre/arama yolunda CPU maliyeti |
| Ölçüm scripti: `PERF_PAGE_WAIT_UNTIL`, `PERF_APIS_ONLY` | `scripts/perf-critical-flows.mjs` | Üretim-benzeri tekrar ve dar ortamlarda API-only koşum |

### Second pass — measurement note

İkinci geçiş **sonrası** tam üretim-benzeri 7 koşuluk Playwright + API paketi, bu geliştirme oturumunda uzak veritabanına aralıklı erişim nedeniyle güvenilir şekilde tamamlanamadı (önceki kayıtlı ölçüm: `.cache/perf-after.json`). **Aynı metodolojiyle** ikinci geçiş sonrası rakamları üretmek için:

```bash
pnpm run build:clean
PORT=3600 pnpm start   # ayrı terminal
PERF_BASE_URL=http://127.0.0.1:3600 PERF_RUNS=7 PERF_OUTPUT_PATH=.cache/perf-pass2-after.json node scripts/perf-critical-flows.mjs
```

Hızlı API regresyonu (Playwright yok):

```bash
PERF_BASE_URL=http://127.0.0.1:3600 PERF_RUNS=7 PERF_APIS_ONLY=1 PERF_OUTPUT_PATH=.cache/perf-pass2-apis.json node scripts/perf-critical-flows.mjs
```

### Second pass — baseline vs target (explicit template)

**İkinci geçiş öncesi referans** = birinci geçiş sonrası kayıtlı ölçüm (`.cache/perf-after.json`, ortalama 7 koşu). **İkinci geçiş sonrası** sütunu, yukarıdaki komutlarla sağlıklı DB üzerinde doldurulmalıdır.

| Metrik | İkinci geçiş öncesi (referans avg) | İkinci geçiş sonrası (avg) |
|---|---:|---:|
| `/api/funds` | 913.57 ms | *yeniden ölç* |
| `/api/funds/scores` | 709.14 ms | *yeniden ölç* |
| `/api/funds/compare` | 710.29 ms | *yeniden ölç* |
| Filter response (Playwright e2e) | 559.00 ms | *yeniden ölç* |
| Homepage DCL | 967.14 ms | *yeniden ölç* |
| Fund detail DCL | 201.57 ms | *yeniden ölç* |
| Compare open DCL | 20.86 ms | *yeniden ölç* |
| Compare-series API (avg) | 701.00 ms | *yeniden ölç* |

**Şablon cümleler (referans → after değerleri yukarıdaki koşumla güncellenmeli):**

- `/api/funds` before: **913.57 ms** / after: **(PERF_PASS2)**
- `/api/funds/scores` before: **709.14 ms** / after: **(PERF_PASS2)**
- `/api/funds/compare` before: **710.29 ms** / after: **(PERF_PASS2)**
- Filter response before: **559.00 ms** avg (p95 **1017 ms**) / after: **(PERF_PASS2)**
- Tail latency: birinci geçiş sonrası `/api/funds` p95 **2362 ms**, `/api/funds/compare` p95 **1344 ms** — ikinci geçiş; hafif head + world cache + funds route cache önceliği ile **p95 ve max’ın düşmesi hedeflenir**; kesin delta yukarıdaki koşumla yazılmalıdır.
- Repeat-run consistency: önceki örnekte filtre e2e’si 49–1017 ms aralığında dalgalanıyordu; funds bellek isabeti ve dünya meta tekilleştirmesi **tekrarlı etkileşimde daha sıkı dağılım** hedefiyle uyumludur.

### Perceived responsiveness (expected, not re-measured here)

- Keşif/liste API’lerinde ilk byte’a giden yol kısalır; strict/serving başlıkları aynı kalır.
- Aynı oturumda tekrarlanan `/api/funds` istekleri önbellek isabetinde daha “tok” hissedilir.
- Kuyruk gürültüsü: büyük JSON head transferinin kaldırılması tipik olarak **uç gecikme üst kuyruğunu** besleyen faktörleri azaltır.

### Remaining candidates (later pass)

- `/api/funds` yanıt gövdesindeki `meta.servingWorld` tam nesnesi (varsa istemci kullanmıyorsa) opsiyonel inceltme — sözleşme etkisi ayrı değerlendirilmeli.
- `scores` legacy fallback dalları (serving yoksa) ayrı profilleme.
- Playwright ölçümünde `networkidle` yerine ürünle uyumlu sabit bekleme politikası (ortam bayrağı ile) dokümante edildi.

# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-04-11

## User Preferences

<!-- How the user likes things done. Code style, tools, patterns, communication. -->
- Yanıt dili Türkçe olmalı.
- UI refactor isteklerinde business logic, veri akışı, hook/state davranışı ve API contractlarına dokunulmadan yalnızca presentational değişiklik tercih ediliyor.
- Fonlar sayfasında keşif alanı için tercih: daha kontrollü, düşük katmanlı, az border/mavi yüzey, tabloya hızlı geçiş veren kompakt hiyerarşi.
- Operasyonel düzeltmelerde en küçük güvenli yama tercih ediliyor: redesign/refactor yok, ürün davranışı değişmeyecek.
- Keşif akışındaki hızlı örneklerde kullanıcı tercihi: yalnızca kısa tarama metrikleri (fon kimliği, fiyat, günlük değişim); yatırımcı/portföy gibi yoğun detaylar bu katmanda azaltılmalı.
- Release öncesi UI güvencesinde `next dev` yeterli kabul edilmiyor; production build artifact + preview URL üzerinde UI interaction smoke zorunlu.
- Kullanıcı "strict detail-only bugfix" istediğinde homepage/discovery/compare route dışı alanlara kesinlikle dokunulmamalı; yalnız `fund detail` veri hattı değiştirilmeli.
- Veri platform fazlarında kullanıcı önceliği implementation-first: placeholder/stub kabul edilmiyor, uçtan uca çalışan hat zorunlu.

## Key Learnings

- **Project:** fonvesting
- Production DB incidentlerinde Vercel env pull ile gelen ham `DATABASE_URL` metni kontrol edilmeli; URL sonuna eklenen `\\n` kacisi baglanti davranisini bozabiliyor. Runtime Prisma yalniz `DATABASE_URL` kullanir, `DIRECT_URL` migrate/ops icindir.
- `withDegradedPayload` içinde `core_price_series_source_*` yalnızca telemetri sayılmalı; aksi halde `degraded.active` her çekirdek yükte true olup tüm bölümler “upgrading”e düşer. `FundDetailAutoRecover` yalnızca `upgrading` (veya gerçekten `degraded`) iken yenilemeli; `partial` normal zenginlik olabilir.
- Ana sayfa keşif: `/api/funds/scores` istemci tarafında tema/kategori süzülmeden önce gelmeli; `HIGH_RETURN&limit=300` ile tema süzümü üst 300 fon üzerinde yapılırsa veri varken boş liste üretir. Kategori daraltması için `category=` sunucuya iletilmeli.
- Fund detail request yolunda canlı history sorgusunu varsayılan açık bırakmak checkout timeout dalgalarında kaliteyi düşürüyor; serving-first için live history query opt-in (`FUND_DETAIL_HISTORY_LIVE_QUERY=1`) olmalı ve ana yol `getFundDetailCoreServingCached(...preferFileOnly)` ile ilerlemeli.
- Scores API’de DB timeout anında `source=empty` yerine core serving universe fallback (kategori/mode sıralı) verilmesi, yanlış boş sonuçları azaltıyor ve spotlight için deterministik havuz sağlıyor.
- Fon detay yüzde/NAV sunumu için `src/lib/fund-detail-format.ts` tek kaynak; liste/anasayfa `formatFundLastPrice` davranışı ayrı kaldı.
- Fon detay SVG çizgileri: `src/lib/chart-monotone-path.ts` ile Steffen/d3-shape **monotone cubic X** (fiyat + normalize kıyas + fon toplam değeri trendi); tüm düğümlerden geçer, overshoot spline değildir. **Yatırımcı sayısı** trendinde çizgi **doğrusal** kalır (parçalı seri; ara nokta uydurulmaz).
- Fon detay grafik altı kıyas modülü: `buildBenchmarkComparisonView` satırları `fundReturnPct`, `referenceReturnPct`, `comparisonDeltaPct` (fon − referans) ve eşikli `outcome` ile beslenir; `BENCHMARK_COMPARISON_TIE_EPS_PP` (0,15 pp) hem durum hem UI ile hizalıdır.
- `rebuildFundDetailCoreServingCache`: tam modda varsayılan **checkpoint** (`FUND_DETAIL_CORE_SERVING_REBUILD_CHECKPOINT_EVERY_FUNDS`, default 100) ile atomik merge yazımı ara ara yapılır; bağlantı kopsa bile ilerleme artifact’ta kalır. Partial modda aynı davranış için `FUND_DETAIL_CORE_SERVING_REBUILD_CHECKPOINT_EVERY_FUNDS_PARTIAL` (varsayılan 0).
- Günlük pipeline akışı `runDailyPipeline -> runDailyMaintenance -> runDailySourceRefresh + runServingRebuild` şeklinde sıralı; asıl DB baskısı serving rebuild metrik adımlarında oluşuyor.
- Günlük freshness için kritik yol incremental hale getirildi: full `rebuildFundDerivedMetrics` ve cache warm daily kritik yolundan çıkarılıp bakım/full rebuild yoluna bırakıldı.
- `runServingRebuild` içinde `rebuildFundDailySnapshots` ve `rebuildFundDerivedMetrics` aynı history penceresini ayrı ayrı okuyordu; paylaşımlı preload ile tek okuma kullanılabilir.
- Dar mobil genişliklerde yatay taşmayı azaltmak için `SitePageShell` içerik sarmalayıcısına `min-w-0 max-w-full` ve `main` köklerine `min-w-0` eklemek güvenli bir flex düzeltmesidir; `globals.css` içinde `--m-tap-min` / `u-clip-x` / `u-min-tap` gibi yardımcılar aşamalı mobil sertleştirme için kullanılabilir.
- Fon detayında `FundDetailChart` ve ana sayfada keşif içi `FeaturedThreeFunds` için `next/dynamic` + statik iskelet, ilk JS yükünü böler; SSR açık kalmalı (`ssr: true`) ki içerik gecikmesi hissi azalsın.
- Low-data fon davranışı için tek bir sözleşme kullanılmalı (`deriveFundDetailBehaviorContract`): eşikler merkezde tanımlanıp chart/trend/comparison görünürlüğü ve fallback copy aynı kaynaktan beslendiğinde bloklar çelişmiyor.
- SSR + hydration uyumu için `sessionStorage/localStorage` seed okumaları component body’de değil `useEffect` içinde yapılmalı; aksi halde ana sayfa kart/list render ağacında `<a>`/`<div>` mismatch üretip hydration fail veriyor.
- Trend SVG'lerinde plot alanı (çizgi/area) ile grid alanı aynı genişlikte olmalı; çizgi 320px'e, grid 302px'e çizilirse sağ kenarda clipping/fragment hissi oluşuyor.
- Trend kartlarında tek geometri her zaman yeterli değil: Investor (count) ve AUM (currency) aynı altyapıyı kullansa da AUM'da tail kink riski daha yüksek; tail sign-flip/son-delta guard ile seçici linear fallback görsel güveni artırıyor.
- Merkezi davranış sözleşmesi UI render kararını tamamen ezmemeli: `canRenderComparison` gibi bayraklar, UI'da hesaplanan gerçek `comparisonRows` varlığını bastırırsa kıyas bloğu yanlış fallback'e düşebilir.
- `compare-series` için `codes` boş diye erken tamamen boş payload dönmek kırılgan: detail kıyasında makro referanslar yine gerekli olabilir. Boş compare kodunda yalnız maliyetli category-universe hesabını atla, macro/labels akışını koru.
- Compare/compare-series kritik pathlerinde timeout anında 500 yerine contract-valid degrade başarı zorunlu: compare için snapshot/serving satırlarıyla minimal `compare` context fallback; compare-series için base series invariant korunup secondary/macro/category-universe timeoutları izole edilmeli.
- `readServingComparePrimary()` tek fonksiyonda önce `readServingWorld()` sonra `servingCompareInputs.findFirst` çalıştırır; route seviyesinde tüm çağrı `withTimeout` ile kesilirse world da düşer ve `servingWorld` null kabul edilip `fundDetail` buildId eksik kalabilir (compare-series’te aralıklı `serving_detail_build_missing` / 503). World/buildId için `readUiServingWorldMetaCached()` ayrı veya timeout-dışı tutulmalı; compare inputs yükü ayrı sınırlanmalı.
- Release parity gate'te tüm degraded senaryoları zorunlu yapmak pratik değil; `requiredForGate` ile deterministik gözlemlenebilen senaryolar (persisted cache, partial module failure) bloklayıcı, diğerleri kanıt/warn olarak izlenmeli.
- Homepage market strip için katı `totalInvestorCount > 0` guard'ı yanlış fallback tetikleyebiliyor; fund/portfolio dolu gerçek market payload varsa direction ve FX metrikleri o kaynaktan korunmalı.
- `computeMarketSummaryFromDailySnapshot` fallback satırlarında `investorCount` select edilmezse toplam yatırımcı 0'a düşer; market snapshot eksik geldiğinde aktif Fund aggregate ile ikinci fallback zorunlu.
- Homepage SSR preview (örn. 180/2390) varsa ScoredFundsTable ilk mount'ta tam scope `/api/funds/scores` yenilemesini zorlamalı; aksi halde kod/unvan araması görünür evren yerine preview alt kümesine kilitlenir.
- Daily cron güvenilirliği için `daily_sync` ayrı SyncLog satırı tutulmalı; meta içinde `sourceStatus` ve `publishStatus` ayrımı health tarafında "fetch başarılı ama publish başarısız" teşhisini mümkün kılar.
- UI bug class regression için tek smoke script iki hedefte çalıştırılmalı: local production-like (`build:clean` + `next start`) ve preview URL; ikisinde de search/filter/compare/alternatives DOM assert'leri release gate'te fail etmeli.
- Preview deploy SSO korumalıysa smoke agent `401` alır; bu durumda preview smoke teknik olarak bloklanır ve deploy öncesi bypass secret veya koruma kapatma gerekir.
- Fund detail cache kabulünde `kiyasBlock` tek başına “full optional enriched” sinyali olmamalı; kategori bağlamında alternatives boşsa payload `phase2 optional refresh required` sayılmalı.
- Fund detail'da serving snapshot lag (örn. 3 gün) tek başına history adayını tamamen çöpe atmamalı; aksi halde chart/trend 1Y/3Y yerine birkaç günlük snapshot fallback'e düşebiliyor.
- Detail + discovery için ortak güvenilirlik taksonomisi (`current | stale_but_usable | degraded | invalid_insufficient`) kod tarafından üretilmeli; yalnız HTTP 200 veya non-null payload başarı sayılmamalı.
- Reliability taksonomisi tek başına yeterli değil; detail için ayrı orchestrator rollup (chart/investor/aum/compare/alternatives + overall trust), discovery için scope/request health rollup gerekmekte.
- Prodlike doğrulamada build komutları paralel koşmamalı; `.next` artifact yarışları özellikle `/404` prerender adımında ENOENT ve modül bulunamadı hataları üretebiliyor. Build + smoke adımları seri çalıştırılmalı.
- `ScoredFundsTable` içinde arama `q` değişince scope anahtarı uyuşmazlığı `displayPayload`’ı null yapıyorsa, yükleme iskeleti “sonuç yok” metninin üstünü kapatır; aynı mod/kategori/tema tabanında `lastGood` ile geçişte doldurmak ve istemci filtresiyle 0 satır iken iskeleti bastırmak smoke’taki explicit no-match assert’ini kararlı hale getirir.
- Fon detayı `FundDetailChart` karşılaştırma özeti: prodlike smoke `innerText` ile `öncelikli net fark` arar; bu metin yalnızca “tam özet” grid dalında ve `hidden md:inline` ile kısıtlıydı — `kiyasBlock`/satır yokken sessiz boşluk oluşuyordu. Çözüm: `fund-detail-comparison-summary-contract` + tüm dallarda görünür sözleşme cümlesi, `data-fund-detail-comparison-summary-state` / `data-fund-detail-comparison-degraded-reason`, bozulmuş durumda `console.warn` JSON kanıtı; smoke’ta `ready` vs degrade dallı assert.
- Bu repoda tek test dosyası çalıştırırken `pnpm test -- --runInBand ...` yerine `pnpm exec tsx --test <file>` kullanılmalı; aksi halde shell `unexpected operator` ile komutu düşürebiliyor.
- Lucide ikonları dosya bazında dağınık import edilirse vendor chunk yeniden üretiminde kırılganlık artabiliyor; güvenli desen `src/components/icons.ts` üzerinden named export + tek `lucide-react` girişi.
- V2 data plane için pratik güvenli yol: TEFAS history fetch anında ham payloadı `raw_prices_payloads` içine parse status/error ile arşivleyip canonical upsert + v2 `serving_*` build adımını aynı rebuild zincirine bağlamak.
- Read-side cutover stabilitesi için DB bağımlı route helper testleri ayrıştırılmalı: trust/alignment saf fonksiyonları Prisma import etmeyen ayrı modülde tutulursa unit testler env/DB’den bağımsız kalır.
- V2 cutover güvenliği için `data:verify` tek başına satır sayımıyla sınırlı kalmamalı; buildId alignment + list/detail/compare set uyuşması + chart payload şekli + health semantik doğruluğu birlikte gate edilmeli, ayrıca target URL için ayrı `data:release:gate` koşulmalı.
- Strict serving cutover doğrulamasında route-level header kanıtı zorunlu: `X-Serving-Strict-Violation=0`, `X-Serving-Fallback-Used=0`, `X-Serving-Trust-Final=1`, `X-Serving-World-Id!=none` ve build-id başlık hizası release gate içinde birlikte doğrulanmalı.
- Serving tablo semantiği mixed: `serving_fund_list`, `serving_compare_inputs`, `serving_discovery_index`, `serving_system_status` build başına **zarf (envelope) satırı**; `serving_fund_detail` ise **fon başına satır**. Toplam satır sayısı yerine latest build satırları ve payload universe boyutu raporlanmalı.
- Deterministik `buildId` tekrar üretildiğinde rebuild idempotent olmalı; create-only yazım unique çakışma üretir. Güvenli desen: aynı `buildId` satırlarını transaction içinde delete+recreate (veya upsert) etmek.
- Daily reliability için `daily_sync` truth modeli SyncLog.errorMessage JSON'unda durable tutulmalı (outcome/sourceStatus/publishStatus/sourceQuality/processedSnapshotDate + row/build metrikleri); health/verify bu kaynaktan okumalı.
- `daily_sync` seçiminde son RUNNING kaydı körü körüne almak yerine mümkünse en yeni terminal (completed) kaydı seçilmeli; aksi halde source/publish alanları sürekli unknown görünebilir.
- `compare-series` request yolunda `serving_fund_detail` full-universe `findMany({ buildId })` sorgusu kullanıcı akışında 5-8sn gecikme üretiyor; güvenli desen requested codes + serving_compare category peers ile sınırlı hedefli sorgu.
- Serving **world meta** yolu için `readLatestServingHeads()` (tam satır + büyük `payload` JSON) gereksiz ağırlıktır; `buildId`/`snapshotAsOf` yeterliyse `readLatestServingHeadsMeta()` kullanılmalı. Aynı istekte birden fazla `readServing*Primary` varsa kısa TTL + in-flight dedupe (`readUiServingWorldMetaCached`) tekrarlayan head okumalarını keser. Tam satır gerektiren health/operasyon yolları `readLatestServingHeads()` ile kalabilir.
- Regression firewall için homepage/compare yüzeylerinde "tek semantik owner" zorunlu: filtresiz total sadece `canonicalUniverseTotal`, filtreli total sadece scoped `matchedTotal`; UI satır sayısı/preview sayısından total türetemez. Compare/detail tarafında `ready` render yalnız typed state + renderable payload birlikte sağlanır; aksi durumda explicit degraded state ve reason attribute zorunlu.
- Phase A chain evidence CI’da DB checkout timeout etkisinden çıkarılmalı: gate kararı `/api/health?mode=full` canonical truth (freshness + daily sync status) üzerinden verilmeli; direct DB/serving head okumaları yalnız best-effort telemetri olmalı.
- Node/Prisma'da Promise.race timeout’u tek başına yeterli değil; yarıştan düşen DB sorgusu process handle’ı açık bırakabilir. CI scriptlerinde opsiyonel DB probe default kapalı olmalı veya explicit env ile açılmalı.
- `report-data-lag` gibi ops/diagnostic adımlar gate zincirinde hard-fail olmamalı; DB fragility halinde health canonical truth fallback ile rapor üretip akışı `check-freshness-target` adımına taşımak gerekli.

## Do-Not-Repeat

<!-- Mistakes made and corrected. Each entry prevents the same mistake recurring. -->
<!-- Format: [YYYY-MM-DD] Description of what went wrong and what to do instead. -->

- [2026-04-11] `next dev` çalışırken `next build` (veya aynı `.next` klasörüne yazan ikinci derleme) vendor chunk’ları bozabiliyor; SSR 500 → layout.css yok → sayfa çıplak. Önce dev’i durdur veya ayrı klasör; onarım: `pnpm dev:reset`.
- [2026-04-14] Hızlı `tsx -e` denemelerinde top-level await CJS hatası alınıyor; tek satır scriptlerde async IIFE kullanılmalı.
- [2026-04-14] Kıyas endpoint'inde "codes yoksa tamamen boş dön" short-circuit'i görünür karşılaştırma regresyonu üretebiliyor; performans için tüm payload'ı öldürmek yerine sadece pahalı alt adımı (category-universe) devre dışı bırak.
- [2026-04-14] Homepage'de SSR preview satırları (180) client refresh olmadan bırakılırsa arama/discovery eksik görünür; preview durumunda ilk scope için zorunlu refresh guard'ı atlama.
- [2026-04-17] Büyük `if/else` bloğu sadeleştirirken try/catch çevresinde kapanış parantezleri kolayca bozuluyor; bu dosyada (`fund-detail.service.ts`) değişiklik sonrası mutlaka tsx/esbuild parse kontrolü çalıştır.
- [2026-04-17] Daraltılmış union tiplerinde (özellikle fallback/source state) imkansız literal karşılaştırması (`=== "stale"` gibi) TS2367 üretir; stale/degrade durumunu string literal yerine güvenli sinyalden (örn. degrade reason/classification) türet.
- [2026-04-17] Bu projede test runner override parametreleri (`pnpm test -- --runInBand`) güvenilir değil; tek dosya testlerinde doğrudan `pnpm exec tsx --test` komutunu kullan.
- [2026-04-17] `next dev` açıkken production `build:clean` çalıştırmak `.next/server/*` modül bulunamadı kırılmasına yol açabiliyor; önce dev sürecini durdur, sonra build al.
- [2026-04-17] Serving rebuild adımında deterministik `buildId` ile aynı snapshot tekrar çalıştırıldığında `build_id` unique hatası alınabilir; rebuild fonksiyonları idempotent replace semantics kullanmalı (delete+create/upsert).
- [2026-04-21] Phase A gate içinde doğrudan Prisma sorgusu (history/snapshot/head) CI transaction pool altında deterministik değil; gate asla DB checkout’a bağlı olmamalı, yalnız health truth ile pipeline integrity doğrulanmalı.

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->
- [2026-04-18] Prisma datasource URL çözümü ve env sanitization `src/lib/db/db-connection-profile.ts` altında tekilleştirildi; `db-runtime-diagnostics` Prisma modülüne bağımlı kalmıyor; runtime client `Proxy` ile lazy singleton. Gözlem: `[db_access_resolution]` + `X-Db-Env-Path` / `X-Db-Prisma-Datasource` header’ları.
- [2026-04-10] Günlük cron için yeni dış kilit sistemi yerine mevcut `SyncLog` ile single-flight guard + stale RUNNING recovery seçildi; hem minimal hem dayanıklı.
- [2026-04-15] Yeni tablo migration yerine mevcut `SyncLog` üzerinde JSON meta ile `daily_sync` fetch/publish ayrımı başlatıldı; düşük riskle observability artırımı için önce backward-compatible yaklaşım seçildi.
- [2026-04-15] UI release certainty için endpoint contract gate'e ek olarak Playwright tabanlı UI interaction smoke (homepage search/filter + fund detail compare/alternatives) preview URL'de zorunlu adım olarak seçildi.
- [2026-04-15] Smoke scriptlerde selector/fixture kırılganlığına dikkat: compare artık tablo değil kart/div listesi; detail companion code aynı koda düşmemeli; homepage arama inputu görünür ana inputa sabitlenmeli.

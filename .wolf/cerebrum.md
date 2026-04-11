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

## Key Learnings

- **Project:** fonvesting
- Fon detay yüzde/NAV sunumu için `src/lib/fund-detail-format.ts` tek kaynak; liste/anasayfa `formatFundLastPrice` davranışı ayrı kaldı.
- Fon detay SVG çizgileri: `src/lib/chart-monotone-path.ts` ile Steffen/d3-shape **monotone cubic X** (fiyat + normalize kıyas + fon toplam değeri trendi); tüm düğümlerden geçer, overshoot spline değildir. **Yatırımcı sayısı** trendinde çizgi **doğrusal** kalır (parçalı seri; ara nokta uydurulmaz).
- Fon detay grafik altı kıyas modülü: `buildBenchmarkComparisonView` satırları `fundReturnPct`, `referenceReturnPct`, `comparisonDeltaPct` (fon − referans) ve eşikli `outcome` ile beslenir; `BENCHMARK_COMPARISON_TIE_EPS_PP` (0,15 pp) hem durum hem UI ile hizalıdır.
- Günlük pipeline akışı `runDailyPipeline -> runDailyMaintenance -> runDailySourceRefresh + runServingRebuild` şeklinde sıralı; asıl DB baskısı serving rebuild metrik adımlarında oluşuyor.
- Günlük freshness için kritik yol incremental hale getirildi: full `rebuildFundDerivedMetrics` ve cache warm daily kritik yolundan çıkarılıp bakım/full rebuild yoluna bırakıldı.
- `runServingRebuild` içinde `rebuildFundDailySnapshots` ve `rebuildFundDerivedMetrics` aynı history penceresini ayrı ayrı okuyordu; paylaşımlı preload ile tek okuma kullanılabilir.
- Dar mobil genişliklerde yatay taşmayı azaltmak için `SitePageShell` içerik sarmalayıcısına `min-w-0 max-w-full` ve `main` köklerine `min-w-0` eklemek güvenli bir flex düzeltmesidir; `globals.css` içinde `--m-tap-min` / `u-clip-x` / `u-min-tap` gibi yardımcılar aşamalı mobil sertleştirme için kullanılabilir.

## Do-Not-Repeat

<!-- Mistakes made and corrected. Each entry prevents the same mistake recurring. -->
<!-- Format: [YYYY-MM-DD] Description of what went wrong and what to do instead. -->

- [2026-04-11] `next dev` çalışırken `next build` (veya aynı `.next` klasörüne yazan ikinci derleme) vendor chunk’ları bozabiliyor; SSR 500 → layout.css yok → sayfa çıplak. Önce dev’i durdur veya ayrı klasör; onarım: `pnpm dev:reset`.

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->
- [2026-04-10] Günlük cron için yeni dış kilit sistemi yerine mevcut `SyncLog` ile single-flight guard + stale RUNNING recovery seçildi; hem minimal hem dayanıklı.

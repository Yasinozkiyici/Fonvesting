# Canlı stabilizasyon — kısa operasyon notu

Bu not, keşif/liste/detay akışlarında görülen degrade durumlarında **nerede bakılacağını** özetler.

## 1. Spotlight boş (öne çıkan üçlü / `server_empty`)

**Beklenen degrade:** Sunucu skor cevabında satır yoksa veya tema/kategori filtresi havuzu sıfırsa öne çıkan kart çıkmaz; kullanıcıya kısa açıklama ve tam liste tabloda kalır.

**Nerede bakılır**

- İstemci: `src/components/home/HomePageClient.tsx` — `[discover-spotlight]` ve `spotlight_pool` / `empty_reason` logları (`server_empty` vs `client_filter_empty`).
- API: `GET /api/funds/scores` — `src/app/api/funds/scores/route.ts` — yanıt başlıkları: `X-Scores-Source`, `X-Scores-Cache`, `X-Scores-Empty-Result`, `X-Scores-Route-Duration-Ms`.
- Veri: Serving birincil paket (`readServingDiscoveryPrimary` + `readServingFundListPrimary`) veya legacy fallback zinciri; gecikme veya eksik build durumunda `discover-server-result` log satırları.

**Beklenmeyen kırılma:** Tabloda fon varken sürekli boş spotlight + tablonun da boş kalması (ayrıca liste yolunu kontrol et).

---

## 2. /sectors ve /indices liste zaman aşımı / “0 fon” hissi

**Beklenen degrade:** İlk boya SSR ile `loadFundsTableInitialSnapshot` (serving tabanlı) ile dolar; istemci `GET /api/funds?...&light=1` tam listeyi tamamlar. Ağır Prisma tam sayfa yolu `light=1` ile atlanır.

**Nerede bakılır**

- SSR: `src/lib/server/funds-table-initial.ts`, sayfalar: `src/app/sectors/page.tsx`, `src/app/indices/page.tsx`.
- API: `src/app/api/funds/route.ts` — `lightList` / cache anahtarı; serving yoksa `buildServingFundsFallback` / `buildScoresCacheFundsFallback`.
- UI: `src/components/tefas/FundsTable.tsx` — ilk fetch süresi, hata banner’ı, “Yeniden dene”.

**Beklenmeyen kırılma:** Özet kartları dolu iken listenin sürekli 0 satır veya kalıcı zaman aşımı (serving + `/api/funds` logları ve `FUNDS_TABLE_FETCH_MS`).

---

## 3. Fon detayı — karşılaştırma özeti düşük / aksiyonlar kapalı

**Beklenen degrade:** Kıyas için yeterli seri veya dönem yoksa özet paneli sınırlı kalır; metinler “veri yok / kısa geçmiş” ile açıklanır. Üretim konsolunda aşırı tanılama logu yoktur (`FundDetailChart`).

**Nerede bakılır**

- `src/components/fund/FundDetailChart.tsx` — `compare-series` isteği, `comparisonSummaryPanelState`, kullanıcıya dönük uyarı başlıkları.
- API: `GET /api/funds/compare-series`.

**Beklenmeyen kırılma:** Sunucu kıyas tablosu doluyken compare-series sürekli 5xx (ağ/API); bu durumda API ve kenar süreleri kontrol edilir.

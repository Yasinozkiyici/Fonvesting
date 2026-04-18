# UI Cutover v2 Phase Report

Tarih: 2026-04-17

## V2'ye Alinan Route'lar (Real Read-Side)

- `/api/funds`: normal yol `serving_fund_list` payload'ini okuyup filtre/siralama/pagination uyguluyor. Legacy yol artik yalniz explicit fallback.
- `/api/funds/scores`: normal yol `serving_discovery_index` + `serving_fund_list` birlesik okuma; snapshot tabanli hesaplama normal-path degil.
- `/api/funds/compare`: normal yol `serving_compare_inputs` + `serving_fund_list`; snapshot/registry yalniz degrade fallback.
- `/api/funds/compare-series`: base/reference varlik kontrolu once `serving_compare_inputs` uzerinden; uyumsuz kodlar degrade sinifi olarak isaretleniyor.
- `/api/market` ve homepage SSR market ozeti: serving tabanli (`serving_fund_list` + `serving_system_status`) uretiliyor.

## UI'da V2 Sozlesmesini Tuketme Durumu

- Homepage/list/discovery hatti ana olarak serving-backed `/api/funds/scores` ve `/api/funds` kullaniyor.
- Compare sayfasi `/api/funds/compare` ile gelen semantic health + world alignment bilgisini okuyup degrade/misaligned durumda acik bir bilgi notu gosteriyor.
- Fund detail route (`/fund/[code]`) `loadFundDetailPageData -> getFundDetailPageData` serving-first hatti ile ilerliyor; kritik metrikler page seviyesinde yeniden hesaplanmiyor.

## Envanter (Data Dependency) - Guncel

- Homepage SSR:
  - skor/list evreni: serving-backed endpointler.
  - market summary: `readServingSystemPrimary` + serving list aggregate.
- Discovery/table client:
  - Ana: `/api/funds/scores`
  - Fallback: legacy path yalniz degrade olarak etiketlenir.
- Detail page:
  - `loadFundDetailPageData` -> `fund-detail.service` (serving-first + orchestrator health/reliability).
- Compare:
  - `/api/funds/compare` (serving_compare_inputs primary; snapshot/registry fallback)
  - `/api/funds/compare-series` (serving_compare_inputs authority + serving_fund_detail series generation).

## Kalan V1/Legacy Bagimliliklari

- `/api/funds` icinde DB `getFundsPage` fallback patikasi korunuyor (serving payload yoksa).
- `/api/funds/compare` icinde snapshot/registry fallback patikalari halen var.
- `/api/funds/compare-series` normal path artik serving-native; legacy fallback yalniz strict/exception durumunda explicit 503 olarak kaldi.

## Kalan Fallback Path'leri (Gozlenebilir)

- Tum cutover route'larinda ortak `X-Serving-Degraded-*`, `X-Serving-Trust-Final`, `X-Serving-Fallback-Used` seti doner.
- `/api/funds` fallback kullanirsa `routeSource=legacy_fallback` ve `fallback_used=1` ile acik etiketlenir.
- `/api/funds/compare` ve `/api/funds/compare-series` mixed/unknown code durumunu degrade olarak isaretler.

## Phase 3 Sonrasi Ek Read-Side Sertlestirme

- Merkezi enforcement yardimcisi (`enforceServingRouteTrust`) eklendi ve kritik route'lara uygulandi.
- `/api/market` artik world metadata'yi null degil serving world uzerinden emite ediyor; list+system build gereksinimi zorunlu.
- `/api/funds` trust/degrade sinifi tek merkezden uretiliyor; serving disi yol explicit `legacy_fallback`.
- `/api/funds/scores` primary serving yolunda trust final karari world/build gereksinimiyle birlestirildi.
- `/api/funds/compare` ve `/api/funds/compare-series` trust/fallback siniflamasi merkezi helper ile hizalandi.

## BuildId / World Gorunurlugu

- Tum kritik route'lar merkezi helper ile ayni world/build header setini uretiyor.
- Homepage list ve market summary serving-world tabanli oldugu icin world ayrismasi riski azaldi.
- Compare tarafi serving compare world'unde olmayan kodlari artik "normal basari" gibi davranmiyor.

## Tam Cutover Oncesi Blokorler

- compare-series ana seri uretimi artik `serving_fund_detail` + `serving_compare_inputs` uzerinden serving-native; legacy detail read helper normal-path'ten cikarildi.
- compare-series icin kalan legacy fallback yalniz strict-violation/exception durumunda explicit `503` ve degraded header ile sinirli.
- fallback path'lerin tamamen kaldirilmasi icin serving rebuild stabilitesi ve coverage oraninin release gate'te daha kati zorlanmasi gerekiyor.
- UI tarafinda degrade/mismatch notlari var; otomatik self-heal/refetch policy sonraki adim.

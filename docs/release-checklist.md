# Release Checklist

## Desktop
- Ana sayfa header, market summary, liste ve footer hizası doğru.
- Detail hero, chart, comparison, profile ve alternatives optik olarak dengeli.
- Compare sayfasında overflow yok.

## Mobil
- 375px, 390px, 430px kontrol edildi.
- Yatay scroll yok.
- Uzun başlıklar ve meta satırları taşmıyor.
- Alt safe area ve sticky elemanlar sorun çıkarmıyor.

## Veri ve durumlar
- Loading / empty / error state’ler bozulmadı.
- `/api/health`, `/api/funds`, `/api/funds/scores`, `/api/market` shape kontrolü yapıldı.
- `/api/funds/compare-series` base + empty/non-empty `codes` senaryoları kontrol edildi.
- Tarih, yüzde, para formatları doğru.
- Veri yoksa yanıltıcı placeholder yok.
- `/api/health` içinde `freshness.lastSuccessfulIngestionAt` ve `freshness.lastPublishedSnapshotAt` alanları doğrulandı.

## Reliability gate
- `daily_sync` son koşu kaydı SUCCESS ve cutoff öncesi tamamlandı.
- `daily_sync` metadata içinde `sourceStatus=success` ve `publishStatus=success`.
- Kritik API’ler DB gecikmesinde hard-empty yerine degrade payload döndürüyor.
- Comparison/chart/alternatives bileşenleri secondary veri eksikliğinde sayfayı çökertmiyor.

## Performans
- Ana sayfa ilk açılış hissi kabul edilebilir.
- Detail route anlamsız derecede şişmedi.
- Liste route’larında duplicate fetch yok.
- Kritik görseller/logolar bozuk URL dönmüyor.

## Guardrail uyumu
- `docs/*.md` kuralları ihlal edilmedi.
- Yeni feature global tasarım dilini bozmadı.
- Mobil davranış ayrıca düşünüldü.

## Komutlar
- `pnpm run prod:check`
- `pnpm exec tsc --noEmit`
- `pnpm run test:unit`
- `pnpm run smoke:ui:prodlike` (clean build + `next start` artifact + UI interaction smoke)
- `SMOKE_BASE_URL="<preview-url>" pnpm run smoke:ui:preview` (bilgilendirici, release blocker degil)
- `RELEASE_PREVIEW_URL="<preview-url>" RELEASE_PRODUCTION_URL="<prod-url>" RELEASE_REQUIRE_PREVIEW=0 RELEASE_REQUIRE_PRODUCTION=1 pnpm run verify:release-readiness`
- `pnpm run verify:release-critical`
- `pnpm run smoke:routes`
- `pnpm run smoke:data`
- `pnpm run audit:system`

## UI release gate (zorunlu fail)
- Homepage search by code (`ZP8`) sonuc getirir.
- Homepage search by name (`is portfoy para`) sonuc getirir.
- Trimmed + case-insensitive query sonuc verir.
- Filtre aksiyonu listeyi anlamsiz olmayan bicimde degistirir.
- `/fund/VGA`, `/fund/TI1`, `/fund/ZP8` detail sayfalarinda kiyas satirlari gorunur.
- Alternatif fon API doluyken detail DOM bos kalmaz.
- "API full but UI empty" gozlenirse release bloklanir.

## Karar siniflandirmasi (zorunlu)
- `GO`: bloklayici adimlar PASS (`tsc`, `test:unit`, `smoke:ui:prodlike`, production-safe remote kontroller).
- `NO_GO`: product/test/runtime sorunu veya production-safe kanit eksigi (`insufficient evidence`).
- `RELEASE_BLOCKED`: production hedefinde auth/protection veya env/config erisim blokaji.
- Protected preview icin `401/403` sonucu **product bug** sayilmaz; `PREVIEW_AUTH_BLOCKER` olarak raporlanir ve advisory not olarak kalir.

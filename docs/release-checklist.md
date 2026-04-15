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
- `pnpm run verify:release-critical`
- `pnpm run smoke:routes`
- `pnpm run smoke:data`
- `pnpm run audit:system`

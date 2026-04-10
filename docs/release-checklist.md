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
- Tarih, yüzde, para formatları doğru.
- Veri yoksa yanıltıcı placeholder yok.

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
- `pnpm run smoke:routes`
- `pnpm run smoke:data`

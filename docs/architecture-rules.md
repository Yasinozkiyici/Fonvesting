# Architecture Rules

## Amaç
Yatirim.io artık sürekli kırılan bir prototip değil, yeni özelliklerin ekleneceği kalıcı ürün tabanıdır. Yeni geliştirmeler mevcut veri akışı, route yapısı ve sayfa hiyerarşisini bozmamalıdır.

## Katmanlar
- `src/app`: route girişleri, metadata, server-first page composition.
- `src/components`: sunum katmanı. Aynı dosyada ağır veri dönüşümü yapılmamalı.
- `src/lib/services`: veri erişimi, cache, payload shaping, domain orchestration.
- `src/lib`: saf helper, formatting, route param okuma, domain utility.
- `src/types`: taşınabilir payload ve view model tipleri.

## Kurallar
- İş mantığını component içine gömme. Veri dönüştürme mümkün olduğunca `lib/services` veya saf helper’larda kalsın.
- Server component içinde gereken veriyi tek akışta topla; aynı ekran için aynı kaynaktan ikinci kez fetch yapma.
- Liste payload’ı ile detail payload’ını ayrı tut. Detail için liste boyutunda JSON taşınmamalı.
- Büyük feature geliyorsa önce mevcut service katmanına uyumlu plan çıkar, sonra kodla.
- Ortak render kalıpları kopyalanmamalı; ortak component veya helper’a çıkarılmalı.
- Global kabuklar (`Header`, `Footer`, `SitePageShell`) route bazlı keyfi çatallanmayacak.
- App Router güvenliği:
  - Kök layout tüm ağacı tek bir `Suspense` ile sarmayacak.
  - `useSearchParams()` kullanan client component kendi `Suspense` sınırında kalacak.
  - Error yüzeyleri boş bırakılmayacak.

## Mevcut mimari notları
- Ana riskli alanlar: büyük client tablolar, detail payload genişliği, cache key değişimlerinde stale UI.
- Güçlü alanlar: service katmanı belirgin, page shell ortak, data freshness/cache mantığı merkezileşmiş.

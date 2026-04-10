# Performance Rules

## Genel
- Mikro optimizasyon değil, gerçek darboğaz hedeflenir.
- Yeni büyük bağımlılık eklenmeden önce neden gerekli olduğu yazılmalı.
- Gereksiz client component ekleme.
- İlk yükte kritik olmayan bloklar ertelenebilir veya lazy yüklenebilir.

## Render
- Derived data her render’da tekrar hesaplanmamalı.
- Büyük client listelerde filtreleme/sıralama maliyeti izlenmeli.
- `content-visibility`, lazy section veya dynamic import sadece gerçekten faydalı yerde kullanılmalı.

## Ağ
- Aynı route için duplicate fetch kabul edilmez.
- Büyük JSON payload önce küçültülmeye çalışılır.
- Cache/revalidate stratejisi veri doğasına göre seçilir; stale UI yaratacak kadar uzun tutulmaz.

## Algılanan hız
- Skeleton ve loading blokları layout shift üretmemeli.
- Global navigation linklerinde gereksiz prefetch yükü oluşmamalı.
- Mobil performans ayrı doğrulanmalı.

## Hız kontrolü
- Yeni feature sonrası en azından şu yüzeyler kontrol edilir:
  - `/`
  - `/fund/[code]`
  - `/compare`
  - ilgili API route’ları

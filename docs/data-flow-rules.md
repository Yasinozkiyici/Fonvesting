# Data Flow Rules

## Temel ilkeler
- Aynı veri aynı ekranda birden fazla kez fetch edilmemeli.
- Liste ve detail route’ları farklı payload sözleşmelerine sahip olmalı.
- API yanıtları UI’da doğrudan kullanılmadan önce normalize edilmeli.
- `null` / eksik veri durumları görünümde patlamaya sebep olmamalı.

## Uygulama kuralları
- Server-first yükleme tercih edilir. İlk boya için kritik veri page/server component tarafında hazırlanmalı.
- Client fetch varsa:
  - loading
  - empty
  - error
  durumları açıkça ele alınmalı.
- URL state gerekiyorsa tek kaynak gibi davranmalı; local state ile çatışmamalı.
- Sayı, para, yüzde, tarih formatlama merkezi helper’lardan geçmeli.
- `logoUrl`, tarih, getiri, kategori gibi alanlarda eski/stale cache sonucu oluşuyorsa cache key revizyonu service katmanında yapılmalı.

## Performans ve doğruluk
- Büyük payload ilk HTML’e gömülmeden önce sorgulanmalı.
- Karşılaştırma ve detail serileri gerektiğinde downsample edilmeli; veri manipüle edilmeden sunum yükü azaltılmalı.
- Global alanlar gereksiz fetch yapmamalı.

## Mevcut riskler
- Cache key değişimi unutulursa stale payload yüzeye sızabilir.
- Büyük client listelerde filtreleme/sıralama maliyeti hızla artar; yeni alan eklenirken bu düşünülmeli.

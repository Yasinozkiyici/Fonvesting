# UI Guardrails

## Görsel yön
- Ürün dili Türkçe kalacak.
- Açık tema, premium-minimal, sakin finans arayüzü çizgisi korunacak.
- Renk paleti keyfi değiştirilmeyecek.
- Border radius, border yoğunluğu, yumuşak shadow ve kart dili tutarlı kalacak.
- Header ve footer keyfi yeniden tasarlanmayacak.

## Hiyerarşi
- Section label > başlık > yardımcı açıklama > ana değer > ikincil metadata düzeni korunacak.
- Büyük değerler dışında hiçbir yardımcı öğe ana metriğin önüne geçmeyecek.
- Badge/chip/icon kullanımı düşük yoğunlukta tutulacak.
- Aynı bilgi iki ayrı blokta tekrar edilmemeli.

## Responsive kurallar
- Mobil görünüm her değişiklikte ayrı düşünülmek zorunda.
- Desktop düzen küçültülerek mobile taşınmayacak.
- Yatay overflow kabul edilmez.
- Uzun başlık, uzun fon adı ve chip taşmaları kontrollü truncate/clamp ile çözülür.

## Yasaklar
- Aşırı badge, gereksiz ikon, agresif renk, ağır shadow, dashboard benzeri gürültü ekleme.
- Finansal doğruluğu olmayan metin, sahte KPI, yanıltıcı başarı vurgusu ekleme.

# Launch Invariants (Frozen Baseline)

Bu not, pre-launch doğrulaması sonrası korunacak davranışları kilitler.

## Homepage summary source-of-truth
- Üst özet, geçerli market payload varken preview satırlarına geri düşmez.
- `usdTry`, yatırımcı toplamı ve yön dağılımı (artan/azalan/sabit) tek kaynaktan tutarlı beslenir.

## Preview vs universe semantics
- Preview satırları yalnızca hızlı ilk render içindir; evren toplamı ile karıştırılmaz.
- UI dilinde preview alt kümesi, tüm evren gibi sunulmaz.

## Default listing/search full-discovery
- Ana route akışında varsayılan listeleme/arama beklenen yerde tam fon evreniyle çalışır.
- Arama/discovery görünür alt kümeye kilitlenmez.

## Themed narrowing rule
- Tema parametresi yalnızca beklendiği route/scope içinde daraltma uygular.
- Tema dışı route'larda false-empty veya hatalı daralma oluşmaz.

## Direct route/search parity
- Doğrudan açılabilen fon kodları (`/fund/{code}`) homepage arama/keşifte de erişilebilir kalır.
- Route erişimi ile discovery erişimi arasında sessiz uyumsuzluk kabul edilmez.

## Detail renderability invariants
- Ana grafik yalnızca renderable payload ile çizilir.
- Trend blokları bağımsız render edilir; zayıf kardeş blok sağlıklı bloğu gizlemez.
- Karşılaştırma/alternatif alanı ya görünür ya da deterministik fallback verir (sessiz kaybolma yok).

## Theme toggle invariant
- Dark/light toggle iki yönlü çalışır; stale state veya tek-yönlü kilitlenme oluşmaz.

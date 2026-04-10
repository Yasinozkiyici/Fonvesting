# Repository Rules

## Beyaz / boş ekran önleme (App Router)

Bu projede “güncellemeden sonra bembeyaz sayfa” genelde şunlardan biridir: yakalanmayan render hatası, `useSearchParams` sınırı eksikliği, kök `Suspense` ile tüm ağacın kilitlenmesi, veya CSS yüklenmeden önce görünür zemin olmaması. Ajan ve kod değişikliklerinde aşağıdakilere uy:

1. **Kök layout’ta tüm `{children}`’ı tek bir `Suspense` ile sarma.** Async `page.tsx` veya alt segment askıda kaldığında tüm site tek bir fallback’te takılır. Gerekirse yalnızca ilgili route’ta `loading.tsx` veya hedefli `Suspense` kullan.
2. **`useSearchParams()` kullanan Client Component’ler** mutlaka kendi route’unda `<Suspense fallback={…}>` içinde olsun; aksi halde üretimde/ HMR’de askı veya boş ekran riski artar.
3. **Sunucudan gelen JSON / API şekli** UI’da doğrudan kullanılmadan önce daraltılmalı (`isCompleteMarketApi` gibi type guard veya güvenli varsayılanlar). Eksik alan `.map` / property erişiminde patlamasın.
4. **Hata yüzeyi:** `src/app/error.tsx` (segment) ve `src/app/global-error.tsx` (kök layout) boş bırakılmamalı; istemci render hataları için `AppErrorBoundary` gibi bir sınır düşünülsün.
5. **İlk boya:** `layout` `<head>` içinde açık/koyu için minimal `html` arka plan + metin rengi (`<style>` veya inline) tanımlı olsun; böylece CSS gecikse bile sayfa tamamen “beyaz boş” görünmez.
6. **Değişiklikten sonra:** `pnpm dev` ile ana sayfa + bir iç route açılsın; konsolda kırmızı hata ve boş `<body>` kalmadığı doğrulansın.

## Stil ve tasarımın “sadece metin kaldı” gibi görünmesini önleme

Güncelleme sonrası düzenin çökmesi (border/flex/kartlar yok, ham metin var) çoğunlukla **bozuk `.next` / webpack chunk uyuşmazlığı** veya **sayfa kabuklarının tutarsız olması** ile karıştırılır. Ajan şunları **standart alışkanlık** olarak uygulasın:

1. **Büyük bağımlılık, `next.config`, PostCSS/Tailwind, `package.json`, `src/app/layout.tsx`, `src/app/globals.css` veya route kabuğu değişikliğinden sonra** yerelde bir kez **`pnpm dev:reset`** çalıştır. **Çalışan `next dev` süreci açıkken elle `rm -rf .next` yapma**; bu repo’da webpack chunk/cache bozulup sayfa “sadece text” veya beyaz ekran verebiliyor.
2. **`src/app/layout.tsx` içindeki `./globals.css` importunu kaldırma.** Ayrıca **`src/pages/_app.tsx`** içinde de aynı global CSS importu dursun; App Router dışı fallback / hata durumlarında sayfa çıplak HTML’ye düşmesin.
3. **Yeni tam sayfa kabukları** (ana akış, fon detayı seviyesinde route’lar) eklerken **`SitePageShell`** (`src/components/SitePageShell.tsx`) veya ilgili ortak kabuğu kullan; gradient-mesh + `z-10` içerik yapısını elle kopyalayarak ikinci bir kabuk üretme.
4. **`src/pages/_document.tsx` ve `src/pages/_error.tsx`** minimal arka plan / metin güvenliğini korusun. HMR veya pages fallback anında “sadece text” görünümü yaşanırsa bu dosyalar ilk kontrol noktasıdır.
5. **Kullanıcı “tasarım gitti” dediğinde** önce **CSS isteğinin 200 dönüp dönmediğini** ve dev server’ın eski chunk servis edip etmediğini kontrol et; şüphede ilk adım **`pnpm dev:reset`** olsun. Özellikle `Cannot find module './XYZ.js'`, `.next/cache/webpack/...pack.gz`, `ChunkLoadError`, `Loading chunk failed` gibi hatalar doğrudan bozuk dev cache sinyalidir.
6. **Kapsamlı UI veya stil dokunuşundan sonra** mümkünse **`pnpm run build:clean`** veya en azından **`pnpm exec tsc --noEmit`** ile üretim derlemesini doğrula.
7. **Değişiklikten sonra** ana sayfa (`/`) ve en az bir iç route (`/sectors`, `/indices`, `/compare` gibi) açılıp header, mesh arka planı, kart/border stilleri ve CSS dosya yüklemesi doğrulanmalı.

## Deployment Safety

- Local code changes must stay local by default.
- Do not run `git push`, `vercel`, `vercel deploy`, or any publish/deploy command unless the user explicitly asks with clear wording such as `push deploy et`.
- Do not assume permission to publish just because code is complete.
- Prefer local verification only: `pnpm dev`, tests, lint, and build checks.
- If deployment is relevant, stop after preparing the code and tell the user what is ready locally.

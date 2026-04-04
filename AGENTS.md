# Repository Rules

## Beyaz / boş ekran önleme (App Router)

Bu projede “güncellemeden sonra bembeyaz sayfa” genelde şunlardan biridir: yakalanmayan render hatası, `useSearchParams` sınırı eksikliği, kök `Suspense` ile tüm ağacın kilitlenmesi, veya CSS yüklenmeden önce görünür zemin olmaması. Ajan ve kod değişikliklerinde aşağıdakilere uy:

1. **Kök layout’ta tüm `{children}`’ı tek bir `Suspense` ile sarma.** Async `page.tsx` veya alt segment askıda kaldığında tüm site tek bir fallback’te takılır. Gerekirse yalnızca ilgili route’ta `loading.tsx` veya hedefli `Suspense` kullan.
2. **`useSearchParams()` kullanan Client Component’ler** mutlaka kendi route’unda `<Suspense fallback={…}>` içinde olsun; aksi halde üretimde/ HMR’de askı veya boş ekran riski artar.
3. **Sunucudan gelen JSON / API şekli** UI’da doğrudan kullanılmadan önce daraltılmalı (`isCompleteMarketApi` gibi type guard veya güvenli varsayılanlar). Eksik alan `.map` / property erişiminde patlamasın.
4. **Hata yüzeyi:** `src/app/error.tsx` (segment) ve `src/app/global-error.tsx` (kök layout) boş bırakılmamalı; istemci render hataları için `AppErrorBoundary` gibi bir sınır düşünülsün.
5. **İlk boya:** `layout` `<head>` içinde açık/koyu için minimal `html` arka plan + metin rengi (`<style>` veya inline) tanımlı olsun; böylece CSS gecikse bile sayfa tamamen “beyaz boş” görünmez.
6. **Değişiklikten sonra:** `pnpm dev` ile ana sayfa + bir iç route açılsın; konsolda kırmızı hata ve boş `<body>` kalmadığı doğrulansın.

## Deployment Safety

- Local code changes must stay local by default.
- Do not run `git push`, `vercel`, `vercel deploy`, or any publish/deploy command unless the user explicitly asks with clear wording such as `push deploy et`.
- Do not assume permission to publish just because code is complete.
- Prefer local verification only: `pnpm dev`, tests, lint, and build checks.
- If deployment is relevant, stop after preparing the code and tell the user what is ready locally.

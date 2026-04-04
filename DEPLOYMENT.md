# Dağıtım notları

Bu repoda **uzak veritabanı adresi, şablon veya migration talimatı tutulmaz**; yanlışlıkla gerçek ortama bağlanma riski kasıtlı olarak kaldırılmıştır.

- Yerel geliştirme: yalnızca SQLite `file:./dev.db` → `prisma/dev.db` (bkz. `.env.example`).
- Production veritabanını sıfırdan kurduğunuzda şema ve süreçleri o ortama özel, sizin onayınızla ayrıca tanımlarsınız.

## GitHub

1. Bu depoyu GitHub’a gönderin (`git push -u origin main`).
2. CI: `main`/`master` üzerinde push ve PR’larda lint + `prisma migrate deploy` (geçici SQLite) + `next build` çalışır.

## Vercel

1. [Vercel](https://vercel.com) → **Add New Project** → GitHub’dan bu repoyu seçin.
2. **Framework Preset:** Next.js (otomatik).
3. **Build Command:** `pnpm run build` (varsayılan yeterli; `postinstall` içinde `prisma generate` çalışır).
4. **Environment Variables** (Supabase/PostgreSQL’e geçince güncelleyin):
   - `DATABASE_URL` — üretim veritabanı bağlantı dizisi (şu an şema SQLite; uzak PostgreSQL için ayrı migration/strateji gerekir).
   - `CRON_SECRET` — korumalı job/sync uçları için güçlü bir gizli anahtar.
5. Şema hâlâ SQLite olduğu için Vercel’de kalıcı dosya tabanlı DB kullanılamaz; canlı ortamda veri için **Supabase (PostgreSQL)** veya benzeri bir sonraki adımda tanımlanmalıdır.

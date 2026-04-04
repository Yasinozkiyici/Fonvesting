# Dağıtım notları

Uygulama **PostgreSQL** kullanır (Vercel’de SQLite dosyası çalışmaz). Yerel ve üretim aynı şema + migration ile uyumludur.

## Yerel

1. `docker compose up -d`
2. `.env` veya `.env.local`: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/fonvesting"` (bkz. `.env.example`)
3. `pnpm install` → `pnpm exec prisma migrate deploy` → isteğe bağlı `pnpm exec prisma db seed`
4. Eski `DATABASE_URL="file:./dev.db"` satırını kaldırın; aksi halde uygulama hata verir.
5. Yerelde yapılan değişiklikler otomatik deploy edilmez; sadece local geliştirme akışı (`pnpm dev`) beklenir.
6. Bu repo için yayın kuralı: kullanıcı açıkça `push deploy et` demeden `git push` veya deploy çalıştırılmaz.

## GitHub

CI: PostgreSQL servis konteyneri üzerinde `prisma migrate deploy`, `lint`, `next build`.

## Vercel

1. Projeyi GitHub’dan içe aktarın. `vercel.json` build sırasında **`prisma db seed`** (boş DB’de örnek veri) ve `next build` çalıştırır. **`prisma migrate deploy` Vercel’de çalıştırılmaz** — Supabase doğrudan host’una birçok buluttan erişim kısıtlı olabiliyor; migration’ları yerelde veya CI’da doğrudan bağlantı ile uygulayın.
2. **Settings → Environment Variables** (Production / Preview için):
   - **`DATABASE_URL`** — Supabase **Transaction pooler** (port **6543**, `?pgbouncer=true&sslmode=require`). Bölge, dashboard’daki pooler host adından gelir (ör. `aws-0-eu-west-1.pooler.supabase.com`).
   - **`CRON_SECRET`** — güçlü rastgele bir dize (sync/job uçları için).
3. **Install Command:** `pnpm install` (`vercel.json` içinde tanımlı).
4. Ortam değişkenlerini ekledikten sonra **Redeploy** yapın.
5. Git push sonrası otomatik Vercel deploy istemiyorsanız Vercel proje ayarlarından auto-deploy kapatılmalıdır; bu davranış repo içi kodla güvenilir biçimde kapatılamaz.

### Supabase (özet)

1. **Project Settings → Database** → **Connection string** → URI, şifreyi yerleştirin; sonuna `?sslmode=require` ekleyin.
2. Vercel’e ekleyin: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `CRON_SECRET`.
3. Yoğun trafikte **Transaction pooler** (6543) + Prisma `directUrl` ayrımı düşünülebilir; başlangıç için doğrudan `db....supabase.co:5432` yeterlidir.
4. **Güvenlik:** Veritabanı şifresi ve anahtarlar yalnızca `.env.local` (gitignore) ve Vercel env’de tutulur; repoya yazılmaz. Sızıntı olursa Supabase’de şifreyi ve API anahtarlarını yenileyin.

### Neon (özet)

1. [Neon](https://neon.tech) → proje oluştur → connection string → Vercel’e `DATABASE_URL`.

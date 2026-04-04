# Dağıtım notları

Uygulama **PostgreSQL** kullanır (Vercel’de SQLite dosyası çalışmaz). Yerel ve üretim aynı şema + migration ile uyumludur.

## Yerel

1. `docker compose up -d`
2. `.env` veya `.env.local`: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/fonvesting"` (bkz. `.env.example`)
3. `pnpm install` → `pnpm exec prisma migrate deploy` → isteğe bağlı `pnpm exec prisma db seed`
4. Eski `DATABASE_URL="file:./dev.db"` satırını kaldırın; aksi halde uygulama hata verir.

## GitHub

CI: PostgreSQL servis konteyneri üzerinde `prisma migrate deploy`, `lint`, `next build`.

## Vercel

1. Projeyi GitHub’dan içe aktarın. Kök dizinde `vercel.json` **build** sırasında `prisma migrate deploy` ve boş DB’de bir kez `prisma db seed` çalıştırır.
2. **Settings → Environment Variables** (Production / Preview için):
   - **`DATABASE_URL`** — Supabase veya Neon’dan **Transaction** veya doğrudan bağlantı dizesi (`?sslmode=require` ekleyin gerekirse).
   - **`CRON_SECRET`** — güçlü rastgele bir dize (sync/job uçları için).
3. **Install Command:** `pnpm install` (`vercel.json` içinde tanımlı).
4. Ortam değişkenlerini ekledikten sonra **Redeploy** yapın.

### Supabase (özet)

1. **Project Settings → Database** → **Connection string** → URI, şifreyi yerleştirin; sonuna `?sslmode=require` ekleyin.
2. Vercel’e ekleyin: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `CRON_SECRET`.
3. Yoğun trafikte **Transaction pooler** (6543) + Prisma `directUrl` ayrımı düşünülebilir; başlangıç için doğrudan `db....supabase.co:5432` yeterlidir.
4. **Güvenlik:** Veritabanı şifresi ve anahtarlar yalnızca `.env.local` (gitignore) ve Vercel env’de tutulur; repoya yazılmaz. Sızıntı olursa Supabase’de şifreyi ve API anahtarlarını yenileyin.

### Neon (özet)

1. [Neon](https://neon.tech) → proje oluştur → connection string → Vercel’e `DATABASE_URL`.

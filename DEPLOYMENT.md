# BISTMarketCap Deployment Sirası

Bu belge, projeyi sorunsuz sekilde production ortamina alma adimlarini siralar.

## 1) Hazirlik (local)

1. `.env.example` dosyasini referans al.
2. Localde test:
   - `pnpm install`
   - `pnpm build`
3. Health endpoint kontrol:
   - `GET /api/health`
4. Predeploy env kontrol:
   - `pnpm predeploy:check`

## 2) Veritabani secimi

Production icin SQLite yerine PostgreSQL onerilir (Supabase veya AWS RDS).

### Prisma provider degisikligi

`prisma/schema.prisma` icinde:

- `provider = "sqlite"` -> `provider = "postgresql"`

Ardindan migration olustur:

- `pnpm db:migrate --name postgres_init`

> Not: Bu adimi productiona cikmadan once staging ortami ile dene.

## 3) GitHub entegrasyonu

1. Projeyi GitHub reposuna push et.
2. Vercel hesabinda `New Project` -> repo sec.
3. Framework: Next.js otomatik secilir.

> macOS notu: Eğer `git` komutlarında Xcode lisans hatası alırsan:
> `sudo xcodebuild -license` komutunu bir kez çalıştırıp onaylaman gerekir.

## 4) Vercel environment variables

Vercel Project Settings -> Environment Variables:

- `DATABASE_URL` (PostgreSQL)
- `YAHOO_SYNC_INTERVAL_HOURS` (`4`)
- `CRON_SECRET` (guclu random string)

## 5) Build ve migration

`package.json` icinde hazir:

- `vercel-build`: `prisma generate && next build`
- `db:migrate:deploy`: `prisma migrate deploy`

Deployment sonrasi bir kere migration calistir:

- `pnpm db:migrate:deploy`

Prod deploy sırası önerisi:

1. `pnpm predeploy:check`
2. `pnpm db:migrate:deploy`
3. Vercel deploy

## 6) Cron sync (4 saatte bir)

`vercel.json` hazir:

- `0 */4 * * *` ile `/api/jobs/sync` endpointini tetikler.

Endpoint auth:

- `Authorization: Bearer <CRON_SECRET>`

## 7) Domain baglama

1. Vercel `Settings > Domains` icine domain ekle.
2. DNS kayitlarini registrar panelinden gir.
3. SSL otomatik aktif olur.

## 8) Go-live checklist

- `/api/health` -> 200
- `/api/stocks` -> veri donuyor
- `/api/indices` -> XU100/XU030 guncel
- `/api/sectors` -> sektor listesi dolu
- cron loglari -> basarili sync

## 9) Opsiyonel ama onerilen

- Sentry hata izleme
- Uptime monitor (health endpoint izleme)
- Haftalik DB backup kontrolu

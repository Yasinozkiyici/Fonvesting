# Deployment

Uygulama tek bir PostgreSQL veritabanı üstünde çalışır. Docker geliştirme doğrulaması için kullanılabilir, production mimarisinin parçası değildir.

## Hedef Mimari

- Vercel: Next.js uygulaması
- PostgreSQL / Supabase: kalıcı veri
- Prisma: şema ve erişim katmanı
- Vercel Cron: günlük 3 aşamalı update zinciri (`/api/jobs/source-refresh` → `/api/jobs/rebuild-serving` → `/api/jobs/warm-scores`)
- Harici kaynaklar: TEFAS, Yahoo, TCMB

## Gerekli Environment Variables

- `DATABASE_URL`: uygulamanın kullandığı PostgreSQL bağlantısı, tercihen Supabase transaction pooler
- `DIRECT_URL`: migration için doğrudan PostgreSQL bağlantısı
- `CRON_SECRET`: `/api/jobs/*` cron endpoint'leri için Bearer token
- `OPS_ALERT_WEBHOOK_URL` veya `SLACK_WEBHOOK_URL`: cron failure / degraded health alarmı için webhook
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`: alarmı Telegram'a da göndermek isterseniz
- `SOURCE_REFRESH_WORKER_WEBHOOK_URL` + `SOURCE_REFRESH_WORKER_TOKEN` (opsiyonel): ağır `source-refresh` işini route dışı worker'a dispatch etmek için
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`
- `NEXT_PUBLIC_BASE_URL`

Örnekler için [.env.example](/Users/vandv/Desktop/Fonvesting/.env.example) ve [.env.local.example](/Users/vandv/Desktop/Fonvesting/.env.local.example) dosyalarına bakın.

## İlk Kurulum

1. `pnpm install`
2. `pnpm prod:check`
3. `pnpm prod:migrate`
4. `pnpm prod:bootstrap`

`prod:bootstrap` tek komutta şunları yapar:

- TEFAS master veri sync
- 2 yıllık fon history backfill
- 2 yıllık makro backfill
- returns / snapshot / derived rebuild
- score cache warm

Özel parametre örneği:

```bash
pnpm prod:bootstrap -- --history-days 730 --macro-days 730 --history-chunk-days 14
```

## Günlük Çalışma

Vercel cron tanımı [vercel.json](/Users/vandv/Desktop/Fonvesting/vercel.json) içinde durur. Günlük update zinciri `Europe/Istanbul` için akşam penceresinde çalışır:

- `17:00 UTC` → `/api/jobs/source-refresh`
- `17:12 UTC` → `/api/jobs/rebuild-serving`
- `17:24 UTC` → `/api/jobs/warm-scores`
- `17:50 UTC` → `/api/jobs/health-check`

Bu üç çağrı birlikte İstanbul saatiyle 20:00 sonrası günlük veri yenilemesini tamamlar. Route’lar sırasıyla [route.ts](/Users/vandv/Desktop/Fonvesting/src/app/api/jobs/source-refresh/route.ts), [route.ts](/Users/vandv/Desktop/Fonvesting/src/app/api/jobs/rebuild-serving/route.ts) ve [route.ts](/Users/vandv/Desktop/Fonvesting/src/app/api/jobs/warm-scores/route.ts) üzerinden çalışır.

`SOURCE_REFRESH_WORKER_WEBHOOK_URL` + `SOURCE_REFRESH_WORKER_TOKEN` tanımlıysa `/api/jobs/source-refresh` ağır history append işini route içinde çalıştırmak yerine dış worker'a dispatch eder. Worker örnek komutu: `pnpm worker:source-refresh`.

`health-check` route'u [route.ts](/Users/vandv/Desktop/Fonvesting/src/app/api/jobs/health-check/route.ts) içinde yer alır; 19:50 İstanbul sonrası günlük SLA kaçırılmışsa veya sistem `degraded` ise alarm yollar.

## Operasyon Dayanıklılığı

- Her cron fazı `SyncLog` tablosuna `RUNNING / SUCCESS / FAILED / TIMEOUT` olarak yazılır.
- Aynı faz yeniden tetiklenirse aktif koşu varken `409 already_running` döner; üst üste binme engellenir.
- 120 dakikadan uzun süren yarım kalmış job kayıtları bir sonraki koşuda `TIMEOUT` olarak işaretlenir.
- `/api/health` artık son `source_refresh`, `serving_rebuild` ve `warm_scores` durumlarını da döner.
- 20:08 / 20:22 / 20:36 İstanbul sonrası ilgili job o gün `SUCCESS` değilse health `degraded/error` üretir.

Günlük akış şunları içerir:

- TEFAS güncel sync
- fon history append
- macro append
- returns rebuild
- market snapshot rebuild
- daily snapshot rebuild
- derived metrics rebuild
- score cache warm

## Vercel Kuralları

- Build sırasında seed çalışmaz; build sadece `next build` yapar.
- Migration Vercel request/build aşamasına bırakılmaz; `pnpm prod:migrate` ile kontrollü yürütülür.
- İlk 2 yıllık backfill web request süresine bağlanmaz; `prod:bootstrap` script’i ile yürütülür.

## Yerel Doğrulama

İsterseniz yerelde PostgreSQL ile test edebilirsiniz:

1. `docker compose up -d`
2. `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/fonvesting" pnpm exec prisma migrate deploy`
3. `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/fonvesting" pnpm sync:macro -- --days 730`
4. `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/fonvesting" pnpm dev`

## Prod DB Smoke

Production deploy sonrası DB/read-path sağlığını hızlı doğrulama:

1. `SMOKE_BASE_URL="https://www.yatirim.io" pnpm run smoke:prod-db`
2. Tüm satırlar `OK` olmalı; herhangi bir `FAIL` satırında `x-db-env-status`, `x-db-connection-mode`, `x-db-failure-class` başlıklarını inceleyin.

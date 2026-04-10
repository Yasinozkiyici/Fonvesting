# Serving Rebuild Worker (Prod)

`serving_rebuild` job'u Vercel serverless lifecycle içinde timeout olabildiği için üretimde yalnızca **authenticated trigger** olarak kalır.
Asıl rebuild, ayrı bir worker process tarafından çalıştırılır.

## Prod env

- `CRON_SECRET`: Vercel cron → `/api/jobs/*` auth (mevcut düzen)
- `SERVING_REBUILD_WORKER_WEBHOOK_URL`: Worker'ın public webhook URL'i
- `SERVING_REBUILD_WORKER_TOKEN`: Worker webhook auth token'ı (Bearer)

## Worker

Çalıştırma:

```bash
pnpm worker:serving-rebuild-server
```

Webhook:
- `POST /` (Authorization: `Bearer $SERVING_REBUILD_WORKER_TOKEN`)

## Tetikleme

Vercel cron:
- `/api/jobs/rebuild-serving` çağırır (Authorization: `Bearer $CRON_SECRET`)
- endpoint worker'a dispatch eder (mode: `worker_dispatch`)


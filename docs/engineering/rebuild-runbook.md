# Data platform — rebuild runbook

> Operatörler için: tam yeniden üretim ve günlük senkron.

## Önkoşullar

- `DATABASE_URL` geçerli; `pnpm exec prisma migrate deploy` güncel.
- TEFAS / makro credentials ve cron secret tanımlı (ortama göre).
- Disk: core serving dosyaları için yeterli alan.

## Komutlar (hedef)

| Komut | Amaç |
|--------|------|
| `pnpm data:backfill:full` | ~3 yıl penceresi; raw/canonical/derived/serving tam yenileme |
| `pnpm data:sync:daily` | Incremental günlük iş |
| `pnpm data:rebuild:serving` | Canonical’dan yalnız serving katmanı |
| `pnpm data:verify` | Tutarlılık + contract kontrolleri |
| `pnpm data:repair` | Bozuk sync state / eksik gün onarımı |
| `pnpm data:health:report` | İnsan okur JSON/Markdown özet |

*İlk sürümde scriptler mevcut `sync-tefas-history`, `rebuild-derived`, `rebuild:detail-core` ile birleştirilebilir; runbook her sprint’te güncellenir.*

## Tam rebuild sırası (önerilen)

1. `data:backfill:full` veya eşdeğeri: önce kaynak history, sonra makro.
2. Canonical rebuild (snapshot + derived).
3. `data:rebuild:serving`.
4. Cache warm (scores) — serving `buildId` sabitlendikten sonra.
5. `data:verify` → başarısızsa dur; `data:repair`.

## Günlük sync

1. `data:sync:daily` (tek uç veya cron).
2. `GET /api/health/data` ve `GET /api/health/serving` ile freshness kontrolü.

## Olay müdahalesi

- **History stale:** `HistorySyncState` + `SyncLog` meta; `recoverStaleHistorySyncState` yolunu incele; ardından manuel `sync:tefas-history`.
- **Serving split-brain:** Liste ve detay farklı `buildId` gösteriyorsa cutover geri al veya tek rebuild.

## Log konumları

- Vercel function logs: `/api/cron/daily`, `/api/jobs/sync`.
- Yerel: stdout; ileride `pipeline_runs` tablosu eklenecek.

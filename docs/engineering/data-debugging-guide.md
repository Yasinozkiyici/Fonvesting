# Veri hattı — hata ayıklama rehberi

> Amaç: koddan okumak yerine sistemin kendi durumunu söylemesi.

## 1. Hızlı teşhis sırası

1. `GET /api/health?full=1` (yetkili ortamda) veya prod light yanıtı + header’lar.
2. `GET /api/health/data` — kaynak + canonical özet.
3. `GET /api/health/serving` — `buildId`, `snapshotAsOf`, satır sayıları.
4. `GET /api/health/fund/[code]` — fon bazlı eksikler.

## 2. Header sözlüğü (`/api/health`)

- `X-Daily-Sync-Source-Status` / `X-Daily-Sync-Publish-Status` — fetch vs publish ayrımı.
- `X-System-Check-Degraded` — genel düşüş.
- `X-Health-Read-Path-Operational` — kullanıcı okuma yolu.

## 3. Semptom → olası kök neden

| Semptom | Bakılacak yer |
|---------|----------------|
| Liste boş, DB dolu | `/api/funds/scores` fallback zinciri; `ScoresApiCache`; kategori parametresi |
| Detay 404 | `loadFundDetailPageData`; kod yok vs veri eksik ayrımı |
| Grafik kısa | History lag; serving snapshot lag; `FUND_DETAIL_HISTORY_LIVE_QUERY` |
| Compare boş | `compare-series` timeout; category universe atlandı mı |
| Makro düz | `MacroObservation` tarihi; Supabase yolu |

## 4. Veri dosyaları ve cache

- Core serving: `fund-detail-core-serving.service` path’leri ve bootstrap durumu (health `serving.detailCore`).

## 5. İleri seviye

- Prisma: `FundDailySnapshot` son tarih; `FundPriceHistory` max date.
- `SyncLog` where `syncType = 'daily_sync'` order by startedAt.

## 6. Tasarım regresyonu

- Stil kaybı: `pnpm dev:reset` (AGENTS.md); bu rehber veri odaklıdır.

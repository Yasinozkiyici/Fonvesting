# DB / veri erişimi mimarisi — stabilizasyon raporu (2026-04-18)

## Kök mimari sorunlar (tespit)

1. **Bağlantı URL çözümü `prisma.ts` içinde gömülüydü** — `db-runtime-diagnostics` ve sağlık yolları aynı URL’yi okumak için Prisma modülünü içe aktarıyordu; bu, “yalnızca env/diagnostic” ihtiyacında bile Prisma yüzeyini çekiyordu.
2. **Ortam string normalizasyonu dağınıktı** — `trim()` tek başına bazı yapıştırma senaryolarında (literal `\n` son ekleri) yetersiz kalabiliyordu; `DATABASE_URL` ile `getDbEnvStatus` farklı ham okuma yapabiliyordu.
3. **Prisma client modül import anında oluşturuluyordu** — soğuk başlangıçta gereksiz engine ömrü; HMR/yanlış bundle sonrası zaten `getPrisma()` ile yenileniyordu, fakat ilk satır `export const prisma = getPrisma()` idi.
4. **P1001 / P1012 gibi init hataları sınıflandırmada zayıftı** — üretim benzeri doğrulamada “timeout vs unreachable vs config” ayrımı log/header kanıtında bulanık kalabiliyordu.
5. **Okuma katmanı önceliği dağınık dokümantasyon** — serving → cache → live Prisma sırası kodda uygulanıyor ancak tek bir “policy” dosyasında sabitlenmemişti.

## Ne konsolide edildi

| Birleşik kaynak | Sorumluluk |
|-----------------|------------|
| `src/lib/db/db-connection-profile.ts` | Ham `DATABASE_URL` / `DIRECT_URL` sanitization, `resolvePrismaDatasourceUrl`, bağlantı modu çıkarımı, `resolveDbConnectionProfile` |
| `src/lib/db/db-access-resolution-log.ts` | Tek satırlık `[db_access_resolution]` JSON kanıtı |
| `src/lib/db/data-source-policy.ts` | Read-side kaynak sırası + “Prisma yalnızca DATABASE_URL” notu |
| `src/lib/db-env-validation.ts` | Artık ham URL okumasını yalnızca profile üzerinden yapıyor |
| `src/lib/prisma.ts` | URL = profile; client = **Proxy ile lazy** singleton |
| `src/lib/db-runtime-diagnostics.ts` | Prisma import’u kaldırıldı; URL profile’dan |

## Değişen dosyalar

- `src/lib/db/db-connection-profile.ts` (**yeni**)
- `src/lib/db/db-connection-profile.test.ts` (**yeni**)
- `src/lib/db/data-source-policy.ts` (**yeni**)
- `src/lib/db/db-access-resolution-log.ts` (**yeni**)
- `src/lib/db-access-resolution-log.ts` — yok, path `src/lib/db/db-access-resolution-log.ts`
- `src/lib/db-env-validation.ts`
- `src/lib/prisma.ts`
- `src/lib/db-runtime-diagnostics.ts`
- `src/lib/system-health.ts`
- `src/lib/database-error-classifier.ts` (P1001 / P1012 + init mesajından `P####` çıkarma)
- `src/lib/database-error-classifier.test.ts` (**yeni**)
- `src/app/api/funds/scores/route.ts` — `X-Db-Env-Path`, `X-Db-Prisma-Datasource`, resolution log
- `src/app/api/health/route.ts` — aynı header’lar
- `src/app/api/funds/scores/route.ts` — `auth_failed` / `invalid_datasource` için DB fallback kısa devre
- `src/app/api/market/route.ts` — degrade listesine aynı sınıflar

## Artık açıkça ele alınan hata modları

- **Env uyumsuzluğu / boş URL**: `getDbEnvStatus` + `resolveDbRuntimeEnvPath`
- **Geçersiz URL / protokol**: validation + `invalid_datasource` (P1012)
- **Sunucuya ulaşılamıyor (init P1001, mesaj eşleşmeleri)**: `network_unreachable`
- **Auth**: mevcut + scores/market kısa devre listesine eklendi
- **Yavaş / pool / statement timeout**: mevcut sınıflandırma korundu
- **Degrade kanıtı**: scores + health header’ları; scores’ta `[db_access_resolution]` satırı

## Hâlâ dış DB erişilebilirliğine bağımlı olanlar

- Tüm **canlı Prisma** okuma/yazma yolları (serving tabloları DB’de durduğu sürece).
- `getSystemHealthSnapshot` içindeki `$queryRaw` ping (strict modda 503 için gerekli).
- Prodlike smoke’un doğruladığı API’ler DB veya serving dolu değilse anlamlı “boş ama dürüst” yanıt üretmeye devam eder; **sahte evren toplamı veya sahte compare başarısı üretilmez** (kabul edilmiş UI sözleşmeleri korundu).

## Ortam / runtime duyarlılığı azaldı mı?

- **Evet, kısmen**: Tek URL resolver + ortak sanitization + diagnostics’in Prisma’dan ayrılması, prodlike / script / `next start` arasında “aynı env farklı yorumlandı” riskini düşürür.
- **Lazy Prisma**: Modül import’u DB’ye gitmez; ilk sorgu anına kadar engine oluşumu ertelenir (soğuk rota ve tree-shake senaryolarında daha deterministik).
- **Gözlemlenebilirlik**: Health ve scores yanıtlarında `X-Db-Env-Path` ve `X-Db-Prisma-Datasource` ile ortam yolu ve pooled/direct politikası tek bakışta sınıflanabilir.

## Regresyon kapsamı

- `pnpm exec tsx --test src/lib/db/db-connection-profile.test.ts`
- `pnpm exec tsx --test src/lib/db-env-validation.test.ts`
- `pnpm exec tsx --test src/lib/database-error-classifier.test.ts`
- Tam paket: `pnpm exec tsc --noEmit` ve mevcut `pnpm test` (repo standardı)

## Duman (smoke) beklentileri

- Bilinçli olarak **gevşetilmedi**; yalnızca HTTP header ekleri ve sunucu log satırı eklendi.

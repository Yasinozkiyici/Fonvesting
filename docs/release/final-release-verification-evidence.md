# Final release verification evidence

Date: 2026-04-18 (güncelleme: DB yolu izolasyonu + tanı)  
Scope: Ortam destekli güvenilirlik; kabul edilmiş düzeltmeler (bug-041, bug-042, homepage no-result) **yeniden açılmadı**.

## Çalıştırılan komutlar

```bash
cd /Users/vandv/Desktop/Fonvesting
pnpm exec tsc --noEmit
```

```bash
RELEASE_REQUIRE_PREVIEW=0 RELEASE_REQUIRE_PRODUCTION=0 pnpm run verify:release-readiness
```

(`verify:release-readiness` sırası: `tsc` → `test:unit` → `smoke:ui:prodlike` = `build:clean` + `next start` + kritik route probu + `smoke:ui-functional`.)

## Sonuç matrisi

| Adım | Sonuç | Not |
|------|--------|-----|
| `pnpm exec tsc --noEmit` | **PASS** | exit 0 |
| `verify:release-readiness` → typecheck | **PASS** | aynı komut zinciri içinde |
| `verify:release-readiness` → unit (`pnpm run test:unit`) | **PASS** | 159 test, exit 0 |
| `verify:release-readiness` → prodlike (`smoke:ui:prodlike`) | **FAIL** | `probeCriticalRoutes` veya smoke aşaması |
| `smoke:ui-functional` (prodlike içinde) | **FAIL** veya önce probe | DB erişimi / zaman aşımı |

### Prodlike / smoke hata özeti (izole kök neden)

- **Kök neden (kanıt):** `resolvePrismaDatasourceUrl()` ile kullanılan `DATABASE_URL`, Supabase **doğrudan** Postgres host’una işaret ediyordu: `db.<ref>.supabase.co:5432`. Bu adres yerel/CI ağında sıkça **erişilemez** veya yavaş kalır; Prisma `P1001` / `Can't reach database server` üretir.
- **Yanlış env sınıfı:** `DIRECT_URL` migrate için bırakılıp **runtime `DATABASE_URL`’in de doğrudan host** olması (pooler yerine) — *pooled vs direct misconfiguration*.
- **Gözlemlenen failure türleri (aynı köke bağlı):** (1) `/api/funds/compare` için `<2 funds`; veya (2) prodlike route probunda `/api/funds/compare?codes=VGA,TI1` için **60s fetch timeout** (sunucu Prisma bağlantısında takılıyor).

### Kod + ortam müdahalesi (2026-04-18)

- **Ortam düzeltmesi (birincil):** `DATABASE_URL`’i transaction **pooler** URL’sine çevirmek (`.env.example` ile uyumlu), **veya** pooler’ı `POSTGRES_PRISMA_URL` içine koyup `DATABASE_URL`’i migrate/direct için saklamak (uygulama runtime artık `POSTGRES_PRISMA_URL`’i önceliklendirir).
- **Kod (tanı + prodlike paritesi):** Aşağıdaki dosyalar; smoke gevşetilmedi, compare sahte fallback yok.

| Dosya | Amaç |
|--------|------|
| `src/lib/db/db-connection-profile.ts` | `readPrismaRuntimeDatabaseUrlRaw()` + `getPrismaRuntimeDatabaseUrlEnvKey()`; `POSTGRES_PRISMA_URL` önceliği; doğrudan `db.*.supabase.co:5432` için tek seferlik `[db-url-hint]`; prodlike’ta `[prisma-datasource-boot]` |
| `src/lib/db-runtime-diagnostics.ts` | `tryFormatDbRuntimeEvidenceOneLiner()` + `prisma_env=` |
| `src/app/api/funds/compare/route.ts` | `codes.length >= 2 && funds.length < 2` iken `[funds/compare-insufficient]` + evidence satırı |
| `scripts/smoke-ui-prodlike.mjs` | Repo kökünde `.env.production.local` → `.env.local` → `.env.production` → `.env` dotenv yükleme; `next start` için `PRODLIKE_VERIFICATION=1`, varsayılan `NODE_OPTIONS` içine `--dns-result-order=ipv4first` (`PRODLIKE_SUPABASE_IPV4_FIRST=0` ile kapatılır) |
| `src/lib/health-db-diagnostics.ts` | `invalid_datasource` union uyumu (tsc) |
| `src/lib/db-runtime-diagnostics.test.ts`, `src/lib/db/db-connection-profile.test.ts` | Yeni sözleşme testleri |
| `.env.example` | Pooler / `POSTGRES_PRISMA_URL` / prodlike DNS notu |

## Beklentiler — bu koşumda kanıtlanabilenler

| Beklenti | Bu oturumda durum | Gerekçe |
|----------|-------------------|---------|
| Homepage olmayan sorgu empty state | **Koşul sağlanamadı** (smoke erken fail) | UI zinciri DB kesintisi + compare assert’ta koptu |
| Homepage’de önizleme/satır sayısının evren toplamı olarak gösterilmemesi | **Kod seviyesinde kapatıldı** (regresyon testleri PASS) | `homepage-fund-counts.test.ts`, `home-market-fund-stats.test.ts`, `resolveFundDetailComparisonSummaryPanelState` vb. unit seti yeşil; prodlike HTML çıktısı bu oturumda kararlı assert edilemedi |
| Detail comparison summary: ready / degraded typed / insufficient_rows, sessiz boşluk yok | **Sözleşme testleri PASS** | `fund-detail-comparison-summary-contract` ile ilgili unit’ler verify öncesi yeşil |
| Homepage totals için log kaynağı | **Kodda mevcut** | SSR’da `[home-ssr-totals]` (`src/app/page.tsx` + `formatHomepageTotalsEvidenceLog`); prodlike log akışı DB hatalarıyla kirli, assert öncesi tam satır yakalanmadı |
| Detail degraded nedenleri log | **Kısmen** | Sunucu loglarında `kiyas_timed_out`, `optional_kiyas_timeout`, Prisma unreachable; smoke karşılaştırma satır sayısında koptu |

## Sınıflandırma (yalnızca izin verilen kategoriler)

Ana failure **DB connectivity / timeout** (uzak Postgres’e ulaşılamıyor) → `/api/funds/compare` yetersiz fon → **smoke selector/assert mismatch değil** (assert iş kurallarına uygun; veri yokluğu sonucu tetiklenmiş).

İkincil gözlem: fund detail aşamasında `optional_kiyas_block_query_timeout_2200ms` — aynı ortam baskısı / DB erişimi ile uyumlu **timeout**, ayrı bir “fallback contract violation” kanıtı üretilmedi.

## Kod blokajı mı, ortam blokajı mı?

- **Bu doğrulama oturumu:** blokaj **ortam** (DB erişilebilirliği). Kabul edilen bug yüzeyleri için yeni regresyon **kanıtlanmadı**; zincir DB olmadan tamamlanamadı.
- **Deploy kararı:** bu kanıt seti tek başına **GO** vermez; sağlıklı DB + aynı komutların yeniden PASS olması gerekir.

## Final GO / NO_GO (deployment)

**NO_GO** (bu makinede son `verify:release-readiness` koşumu) — **prodlike_ui** hâlâ başarısız; kök sınıf: **DB connectivity / timeout** + **direct Supabase host’ta `DATABASE_URL`**. Kod tarafı yalnızca çözüm yolunu ve log kanıtını netleştirir; **pooler veya erişilebilir ağ** olmadan PASS beklenmez.

## Açık kalan release blokajı

1. **Ortam:** `.env.local` / CI secret’larında Prisma runtime için **pooler** (`…pooler.supabase.com:6543`, `pgbouncer=true`) — tercihen `DATABASE_URL` üzerinden veya **`POSTGRES_PRISMA_URL`** ile `DATABASE_URL`’i direct bırakarak. Ardından: `RELEASE_REQUIRE_PREVIEW=0 RELEASE_REQUIRE_PRODUCTION=0 pnpm run verify:release-readiness` **tam PASS**.

Kapalı konulara dönüş yok: yeni regresyon kanıtı yok; tekrarlanan iş **ortam doğrulaması**dır.

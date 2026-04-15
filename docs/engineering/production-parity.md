# Production Parity and Release Certainty

Bu dokuman, fonvesting'te "lokalde duzeldi" varsayimini bitirip production-parity dogrulamayi release oncesi zorunlu hale getirmek icin uygulanacak sistemi tanimlar.

## A) Why local fixes are not surviving production

Fonvesting icin lokal/canli uyumsuzlugunun en olasi sebepleri:

1. **Data volume mismatch**
   - Lokal veri seti kucuk/temiz, production veri seti buyuk ve tutarsizlik barindiriyor.
   - Scores/compare/chart path'leri yuksek evrende farkli davraniyor.
2. **DB/pool timing mismatch**
   - Production pool checkout timeout, transaction timeout ve connection closure senaryolari lokalde tekrar edilmiyor.
3. **Cache state mismatch**
   - Lokal cache sicakken production stale/partial olabilir.
   - Serving artifact ve memory cache state'i farkli.
4. **Scheduled job state mismatch**
   - Daily sync run state'i (RUNNING stale, FAILED, partial publish) lokalde simulasyon gormuyor.
5. **Freshness/snapshot mismatch**
   - Latest expected session ile latest snapshot ayrisinca UI/API path'leri farkli fallback davranisi veriyor.
6. **Timeout pressure behavior**
   - Route logic timeout altinda degrade path'e geciyor; lokalde bu yol test edilmiyor.
7. **Happy-path shape dependency**
   - UI modulleri beklenen shape disinda gelen payload ile kiriliyor (secondary data eksiginde cokus).

## B) Production parity plan

Zorunlu parity sistemi:

1. **Seeded snapshot fixtures**
   - Son snapshot, bir onceki snapshot, stale snapshot fixture setleri.
2. **Persisted fallback fixtures**
   - Serving/artifact fallback fixture'lari (file/cache kaynakli).
3. **Stale/degraded fixtures**
   - `yesterday-missing`, `publish-failed`, `partial-materialization` fixture setleri.
4. **Timeout/slow-query simulation**
   - Kritik route'lar timeout siniri altinda degrade contract testine sokulur.
5. **Failed-ingestion simulation**
   - Fetch success + publish fail ayrimi fixture/metadata ile test edilir.
6. **Freshness anomaly simulation**
   - `latest expected session > latest published snapshot` durumu test edilir.
7. **Critical route replay**
   - User-facing endpoint replay seti her release oncesi zorunlu calisir.

## C) Mandatory critical-path verification set

Her release oncesi asagidaki akislarda contract dogrulanir:

1. `scores BEST unfiltered` (`/api/funds/scores?mode=BEST&limit=300`)
   - Non-empty: `funds.length > 0`
   - Degraded: `funds` array var
   - Empty allowed: yalniz explicit `source=empty`
2. `scores filtered` (`/api/funds/scores?mode=BEST&category=...`)
   - Non-empty: `funds.length > 0`
   - Degraded: `funds` array var
   - Empty allowed: filtre sonucu gercekten yoksa ve payload contract tam ise
3. `comparison payload` (`/api/funds/compare?codes=...`)
   - Non-empty: `funds >= 2` ve `compare` object
   - Degraded: `funds` array + `compare` alani mevcut
   - Empty allowed: `funds=[]` ve `compare=null`
4. `primary chart payload` (`/api/funds/compare-series?base=...`)
   - Non-empty: base fund series dolu
   - Degraded: `fundSeries` ve `macroSeries` shape korunmus
   - Empty allowed: hayir (base chart kritik)
5. `alternatives payload (proxy)` (`/api/funds/compare?codes=...`)
   - Non-empty: en az 2 fon
   - Degraded: `funds` array contract korunmus
   - Empty allowed: yalniz explicit null compare
6. `freshness/last-update state` (`/api/health?mode=light`)
   - Non-empty: freshness object mevcut
   - Degraded: status + freshness mevcut
   - Empty allowed: hayir
7. `daily ingestion status / yesterday-missing` (`/api/health?mode=full`)
   - Non-empty: `jobs.dailySync` + freshness mevcut
   - Degraded: `dailySync` veya issue listesi mevcut
   - Empty allowed: hayir

## D) Release certainty workflow

Bir degisiklik "done" sayilmaz, su sirayla tum gate'ler gecmeden:

1. Contract checks pass (`verify-critical-routes`).
2. Production-like fixture run pass.
3. Degraded-path checks pass (`VERIFY_SCENARIO=degraded`).
4. Critical routes replay setinde regresyon yok.
5. Freshness invariants pass (`dailySync`, snapshot freshness, missed SLA).
6. Production deploy oncesi `Release Critical Gate` workflow PASS (target URL uzerinden).

## E) Immediate implementation plan

### Phase 1 (this week)
- Kritik route contract verifier scripti (ilk patch).
- Release checklist'e verifier adimi ekleme.
- Freshness + daily sync status zorunlu gate.

### Phase 2 (next)
- Fixture/simulators: stale, timeout, failed-ingestion, yesterday-missing.
- Contract test dosyalari (`tests/contracts/*`) ve CI entegrasyonu.

### Phase 3 (stabilization operating model)
- Haftalik reliability review (missed SLA, degraded ratio, critical failure classes).
- Release raporunda parity evidence zorunlulugu.
- Yeni feature PR'larinda critical-path impact alaninin zorunlu doldurulmasi.

## F) Concrete repo changes

Bu turda:
- `docs/engineering/production-parity.md` (yeni)
- `scripts/critical-path-contracts.mjs` (yeni)
- `scripts/verify-critical-routes.mjs` (yeni)
- `package.json` scriptleri: `verify:critical-routes`, `verify:release-critical`

Sonraki adimlar:
- `scripts/simulate-stale-state.ts`
- `tests/contracts/scores-critical.test.ts`
- `tests/contracts/comparison.test.ts`
- `tests/contracts/chart.test.ts`
- `tests/contracts/alternatives.test.ts`

## G) First patch now

Ilk temel patch: kritik endpointler icin reusable contract verifier.

- Route bazli contract tanimi var.
- Non-empty/degraded/empty-allowed semantiklerini kodluyor.
- Retry + timeout + structured audit log uretiyor.
- `VERIFY_SCENARIO=normal|degraded` ile ayni script iki modda calisiyor.

Calistirma:

- `pnpm run verify:critical-routes`
- `VERIFY_SCENARIO=degraded pnpm run verify:critical-routes`
- `pnpm run verify:release-critical` (senaryo kaniti zorunlu)
- GitHub Actions: `Release Critical Gate` (workflow_dispatch, target deployment URL)

## H) Release-oriented output model

Verifier ciktisi release dilinde okunur:

- Critical path bazinda `PASS/FAIL`
- Her fail satirinda `failing_contract=<...>`
- Fail kapsami:
  - `scope=live-path-only` (degraded path ayakta, live path kirik)
  - `scope=total-path` (hem live hem degrade kontrati kirik)
- Ayrica degraded senaryo evidence raporu:
  - `PASS` (senaryo gozlemlendi ve kontrat saglandi)
  - `WARN` (senaryo bu kosuda gozlemlenmedi, enforcement kapali)
  - `FAIL` (senaryo gozlemlendi ama kontrat kirik veya enforcement acik ve evidence yok)

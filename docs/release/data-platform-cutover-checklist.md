# Data platform cutover checklist (operational)

> Amaç: dekoratif checklist değil, kanıt-temelli GO/NO-GO kontrolü.

## 0) Pre-cutover prerequisites

- [ ] `docs/engineering/system-rebuild-audit.md` onaylı.
- [ ] `docs/engineering/target-data-architecture.md` onaylı.
- [ ] Migration’lar prod’a deploy edildi (`raw_*`, `serving_*`, `fund_health_daily` dahil).
- [ ] Rollback owner ve iletişim kanalı atandı.
- [ ] Son 3 günlük pipeline run trendi mevcut (freshness + parse failure + alignment).

## 1) Required data integrity checks

- [ ] `pnpm data:verify` çıktı `gateDecision=GO`.
- [ ] `rawPricesRowCount > 0`.
- [ ] `rawPricesParseFailedCount / rawPricesRowCount <= 0.02`.
- [ ] Canonical latest snapshot kritik metrik boşluğu = 0.
- [ ] Serving satırları: list/detail/compare/discovery/system hepsi > 0.
- [ ] BuildId alignment: list/detail/compare/discovery/system aynı.
- [ ] List/detail/compare code set mismatch = 0.
- [ ] Chart series malformed sayısı = 0 (sampling raporu eklendi).

## 2) Health endpoint checks

- [ ] `/api/health?mode=full` readPathOperational = true.
- [ ] `/api/health/data` freshnessAssessment.staleDays <= 2.
- [ ] `/api/health/serving` quality.buildAligned = true.
- [ ] `/api/health/fund/[critical-code]` canonical + serving head tutarlı.
- [ ] `/api/health?mode=full` içinde en güncel `daily_sync` run timestamp mevcut.
- [ ] `/api/health?mode=full` daily outcome/sourceStatus/publishStatus strict success.
- [ ] `/api/health?mode=full` sourceQuality anomali değil (`empty_source_anomaly`/`partial_source_failure` yok).
- [ ] `/api/health?mode=full` publishBuildId mevcut ve serving build ile tutarlı.
- [ ] Ardışık run kanıtı: `pnpm data:daily:ledger-evidence` (veya `--json`) ile son N `daily_sync` satırında `outcome`, `sourceStatus`, `publishStatus`, `sourceQuality`, `processedSnapshotDate`, `publishBuildId` doluluğu kontrol edildi; tercihen `pnpm data:daily:ledger-evidence --strict` geçti.

## 3) Prodlike runtime checks

- [ ] `pnpm smoke:ui:prodlike` geçti (build artifact + `next start`).
- [ ] `pnpm smoke:data` geçti.
- [ ] `pnpm verify:critical-routes` normal geçti.
- [ ] `pnpm verify:critical-routes` degraded geçti.
- [ ] `SMOKE_BASE_URL=<target> pnpm data:release:gate` geçti.
- [ ] Strict cutover doğrulaması aktif (`x-serving-strict: 1` veya `SERVING_CUTOVER_STRICT=1`).
- [ ] Strict modda kritik route’larda `X-Serving-Strict-Violation=0`.
- [ ] Strict modda kritik route’larda `X-Serving-Fallback-Used=0`.
- [ ] Strict modda kritik route’larda `X-Serving-Trust-Final=1`.
- [ ] Strict modda kritik route’larda `X-Serving-World-Id != none` ve `X-Serving-World-Aligned=1`.
- [ ] Strict modda kritik route’larda build başlıkları (`fundList/compare/system`) mevcut ve hizalı.

## 4) Cutover execution checks

- [ ] Cutover anında serving `buildId` kaydedildi.
- [ ] Cutover commit hash kaydedildi.
- [ ] Cache/revalidation planı uygulandı.
- [ ] Cutover sonrası ilk 30 dk’da health + smoke tekrarlandı.

## 5) Rollback triggers (automatic NO-GO / rollback)

- [ ] Serving tables boş veya kritik şekilde düşmüş.
- [ ] BuildId mismatch (list/detail/compare/discovery/system).
- [ ] Health endpoint semantik kırık (readiness false ama 200-success maskesi).
- [ ] Critical API contract kırığı.
- [ ] Strict cutover route’larından biri `serving_strict_violation` döndü.
- [ ] Strict modda fallback/degraded kaynak kullanımı gözlendi (`X-Serving-Fallback-Used=1` veya degraded header).
- [ ] Prodlike smoke kırığı.
- [ ] Freshness breach (`staleDays > 2`) ve hızlı onarım yok.
- [ ] `daily_sync_not_completed_today` blocker tetiklendi.
- [ ] `daily_sync_publish_lag` blocker tetiklendi.
- [ ] `daily_sync_publish_failed` blocker tetiklendi.
- [ ] `daily_sync_source_quality` blocker tetiklendi.
- [ ] `daily_sync_outcome_strict_success` blocker tetiklendi.

## 6) Rollback method

1. Serving-read feature flag kapat, legacy read path’e dön.
2. Varsa son iyi serving `buildId`e pinle.
3. Daily publish/rebuild cron’u durdur (veri bozulması büyümesin).
4. Incident raporu: kök neden + tekrar-cutover şartları.

## 7) Post-cutover validation (first 24h)

- [ ] Saatlik `/api/health/data` ve `/api/health/serving` izlemi.
- [ ] En az 3 kritik fon için fund-level health doğrulaması.
- [ ] UI compare/detail smoke tekrar koşusu.
- [ ] Parse failure/source failure trendi normal bandda.

## 8) GO / NO-GO evidence package

- [ ] `docs/engineering/cutover-readiness-report-template.md` tam dolduruldu.
- [ ] `data:verify`, `verify:critical-routes`, `smoke:ui:prodlike`, `data:release:gate` çıktıları eklendi.
- [ ] Strict cutover route evidence eklendi (route bazında: fallbackUsed, trustFinal, worldId, build ids, strictViolation).
- [ ] Daily reliability evidence eklendi (lastRunTimestamp, processedSnapshotDate, outcome, sourceStatus, publishStatus, sourceQuality, publishBuildId, publishLagHours, blockerReasons).
- [ ] Ardışık günlük ledger JSON/text çıktısı eklendi (`pnpm data:daily:ledger-evidence --json` veya `--strict` kanıtı).
- [ ] Karar net: `GO` / `LIMITED_GO` / `NO_GO`.

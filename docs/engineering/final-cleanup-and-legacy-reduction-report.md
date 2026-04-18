# Final cleanup & legacy reduction report

**Tarih:** 2026-04-17  
**Kapsam:** Fon detay kıyas modülü düzeltmesi, kalan hibrit/legacy riskleri, sözleşme ve test güncellemeleri.

---

## 1. Kalan problemli / legacy alanlar (odaklı denetim)

| Alan | Kullanıcı görünür mü? | Şiddet | Kök neden (özet) | Dosyalar | Öneri |
|------|------------------------|--------|-------------------|----------|--------|
| Fon detay — grafik penceresi vs `kiyasBlock` dönem satırları | Evet | Yüksek | Pencere tabanlı hesap makro seri hizası olmadan düşüyor; blok yedek sadece **kategori** için uygulanıyordu; BIST/faiz vb. boş kalabiliyordu. | `src/lib/fund-detail-comparison.ts`, `src/components/fund/FundDetailChart.tsx` | **Düzeltildi:** tüm ref anahtarları için blok satırı yedeklemesi. |
| Fon detay — `compare-series` istemci ön yüklemesi atlanması | Evet | Yüksek | `serverKiyasHasComparableRows === true` iken prefetch **hiç çalışmıyordu**; kategori ortalaması serisi yalnızca `compare-series` ile gelir (`chartMacroByRef` kategoriyi içermez). | `src/components/fund/FundDetailChart.tsx`, `src/lib/services/fund-detail-kiyas.service.ts` | **Düzeltildi:** sunucu kıyası dolu olsa da compare-series prefetch. |
| Fon detay — “Getiri karşılaştırması” boş satır ızgarası | Evet | Orta | `comparisonRows.length > 0` yeterli sayılıyordu; tüm satırlar `insufficient_data` olsa bile bölüm açılıyordu (etiket + “—”). | `src/components/fund/FundDetailChart.tsx` | **Düzeltildi:** bölüm yalnızca anlamlı (en az bir hesaplı fark) varsa. |
| İstemci compare-series gövdesi doğrulanmıyor | İç / dolaylı görünür | Orta | `setCompareData(body)` ham JSON; şekil uyuşmazlığı sessizce kırık state. | `src/components/fund/FundDetailChart.tsx` | **Düzeltildi:** `normalizeCompareSeriesResponseBody`. |
| Davranış sözleşmesi — kıyas `canRenderComparison` yalnız 1Y | İç (UI bayrakları) | Düşük | `countComparisonValidRows` sadece `periodId === "1y"` sayıyordu; başka dönemlerde geçerli kıyas olsa bile coarse bayrak yanlış olabiliyordu. | `src/lib/fund-detail-section-status.ts` | **Düzeltildi:** her ref için herhangi bir dönemde geçerli `fundPct`+`refPct`. |
| `compare-series` strict-mode 503 | Evet (ortam bağlı) | Orta–yüksek (env) | Degrade veya unknown compare kodunda route 503 dönebilir; istemci `compareData` null kalır. | `src/app/api/funds/compare-series/route.ts` | **Kasıtlı güvenlik modeli** — sunucu `kiyasBlock` + blok yedek ile telafi; tam strict ortamda operasyonel gerekçe dokümante. |
| Hibrit okuma: detay sayfası SSR kıyas + istemci macro | Evet | Düşük (bilinçli) | İki kaynak birleşimi (`pickBenchmarkMacroSeries`) gerekli; tamamen kaldırılmamalı. | `src/components/fund/FundDetailChart.tsx` | **Tut** — doğru birleşim. |
| `fund-detail-orchestrator.test.ts` içindeki `kiyasBlock` şekli | Hayır (test drift) | Düşük | Eski/yanlış mock şema (`refs` vs `FundKiyasViewPayload`). | `src/lib/services/fund-detail-orchestrator.test.ts` | İleride düzeltilebilir (bu görev kapsamı dışı). |

---

## 2. Fon detay kıyas modülü — yapılan düzeltmeler

1. **`buildRowsFromSeriesWindow`:** Makro seri pencerede okunamadığında, sunucunun aynı `periodId` için ürettiği `rowsByRef[key]` satırı varsa (geçerli `fundPct` / `refPct`) artık **tüm referans tipleri** için kullanılıyor (önceden yalnızca `category`).
2. **`FundDetailChart`:** `compare-series` ön yüklemesi sunucu kıyas tablosu dolu olsa da çalışıyor; kategori serisi ve güncel macro için gerekli.
3. **Görünürlük:** “Getiri karşılaştırması” yalnızca en az bir satırda gerçek `comparisonDeltaPct` olduğunda render ediliyor; aksi halde mevcut `comparisonFallbackCopy` ile dürüst degrade.
4. **Sözleşme:** API yanıtı `normalizeCompareSeriesResponseBody` ile doğrulanıyor; geçersiz gövde state’e yazılmıyor.

---

## 3. Legacy / hibrit yol temizliği

- **Kaldırılan mantık:** “Sunucuda kıyas satırı varsa compare-series prefetch yapma” — bu hibrit kural kategori ve pencere hizasını kırıyordu.
- **Genişletilen mantık:** Pencere + blok birleşiminde kategori-özel istisna kaldırıldı; tek tip blok yedek.

---

## 4. Yanıltıcı UI durumları

- Boş benchmark tablosu (tüm satırlar “—” / veri yetersiz) artık ana “Getiri karşılaştırması” kartında gösterilmiyor; fallback metin kullanılıyor.
- Karşılaştırma kontrolleri (chip’ler) mevcut tasarımda kalıyor; veri yoksa zaten `available: false` ile soluk ve devre dışı.

---

## 5. Sözleşme / hesap bütünlüğü

- `buildBenchmarkComparisonView` `labels` parametresi `Partial<Record<string, string>>` ile hizalandı (istemci + sunucu).
- Compare-series istemci payload’ı: zorunlu `macroSeries` alt alanları + `fundSeries` yapısı doğrulanıyor.

---

## 6. Testler

- `src/lib/fund-detail-comparison.test.ts` — blok yedek + boş makro seri (BIST100) senaryosu.
- `src/lib/compare-series-client-payload.test.ts` — meta, error, eksik macro, geçersiz nokta.

---

## 7. Performans / güvenlik notları

- Compare-series çağrısı fon detayında zaten sınırlı (imza dedup, retry üst sınırı); release gate ve strict-mode semantiği değiştirilmedi.
- Strict ortamda compare-series 503 ise UI sunucu `kiyasBlock` ve genişletilmiş blok yedek ile anlamlı satır üretebilir.

---

## 8. Bilinçli olarak sonraya bırakılanlar

- `fund-detail-orchestrator.test.ts` içindeki eski `kiyasBlock` mock şemasının `FundKiyasViewPayload` ile uyumlu hale getirilmesi.
- İsteğe bağlı: `chartMacroByRef` içine kategori için günlük seri üretmek (şu an kategori için compare-series veya blok dönem satırı kullanılıyor).

---

## 9. Değişen dosyalar (özet)

- `src/lib/fund-detail-comparison.ts`
- `src/lib/fund-detail-section-status.ts`
- `src/lib/compare-series-client-payload.ts` (yeni)
- `src/lib/compare-series-client-payload.test.ts` (yeni)
- `src/lib/fund-detail-comparison.test.ts`
- `src/components/fund/FundDetailChart.tsx`
- `docs/engineering/final-cleanup-and-legacy-reduction-report.md` (bu dosya)

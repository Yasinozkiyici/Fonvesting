# Semantic Freeze Contract (Homepage + Compare/Detail)

Bu belge, semantik drift’i engelleyen freeze owner ve invariant sözleşmesini tanımlar.

## Canonical Owners

- **Homepage totals owner**
  - Filtresiz: `canonicalUniverseTotal` (SSR kanonik evren)
  - Filtreli: scoped payload `matchedTotal`
  - Uygulama: `resolveHomepageRegisteredTotal`
- **Homepage discovery/table surface-state owner**
  - Uygulama: `deriveHomepageDiscoveryTableSurfaceState`
  - UI loading/ready/empty/degraded dalları yalnız bu typed state üzerinden çalışır.
- **Compare surface-state owner**
  - Uygulama: `normalizeCompareApiBoundary(...).surfaceState`
  - `meta.surfaceState` ile override yasak.
- **Fund detail comparison summary owner**
  - Uygulama: `resolveFundDetailComparisonSummaryPanelState`
  - Invariant: `validateFundDetailComparisonSummaryState`

## Forbidden Drift Patterns

- `total ?? funds.length` veya benzeri row-count tabanlı total türetimi.
- Preview/scoped/loaded satır sayısını kanonik evren gibi sunmak.
- UI katmanında ham payload’dan yeni semantik state üretmek.
- Ready state’in renderable payload olmadan gösterilmesi.
- Degraded state’in typed reason olmadan gösterilmesi.

## Required QA/Smoke Selectors

- **Homepage discovery/table**
  - `data-surface-state`
  - `data-surface-reason`
- **Compare page**
  - `data-compare-surface-state`
  - `data-surface-state`
  - `data-surface-reason`
- **Fund detail comparison summary**
  - `data-fund-detail-comparison-summary-state`
  - `data-surface-state`
  - `data-surface-reason`
  - `data-fund-detail-comparison-degraded-reason`

## CI Invariant Policy

- Runtime invariant ihlali prod’da loglanır.
- Test/CI’de invariant ihlali deterministik fail olmalıdır.
- Uygulama yardımcısı: `guardSemanticInvariant` (`src/lib/data-flow/invariant-guard.ts`).


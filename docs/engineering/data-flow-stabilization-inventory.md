# Data-flow stabilization — inventory (PHASE 1)

**Scope:** Homepage list/discovery + totals, fund detail core, comparison summary, market summary, compare API dependencies.  
**Goal:** Map raw → fallback → normalize → semantic decision → UI assumption → risk.

---

## 1. Homepage list / discovery

| Stage | Source | Fallback | Normalize | Semantic decision | UI assumption | Risk |
|-------|--------|----------|-----------|-------------------|---------------|------|
| SSR rows | `getScoresPayloadFromDailySnapshot` (DB) | timeout → null; then `scoresPreviewFromServingRows` (`listFundDetailCoreServingRows`) | **Previously:** raw row → client; **Now:** `normalizeScoredResponse` at SSR boundary (`src/lib/data-flow/homepage-boundary.ts`) | `initialRowsSource`: scores \| serving_core \| none | `ScoredFundsTable` treats `initialScoresPartial` to refetch full scope | Empty/malformed fund rows → client `.trim` / theme match crashes |
| Categories | Serving rows-derived list OR `getCategorySummariesFromDailySnapshotSafe` | timeout → `[]` | **`normalizeHomepageCategoryList`** (code+name publishable) | Intent + URL category resolved against list | Rail chips, `resolveDiscoveryFilters` | `name` null → `normalizeTr` / hint matching crash |
| Theme URL | `readSearchParam` + `parseFundThemeParam` | — | `parseFundThemeParam` (nullish-safe) | Valid `FundThemeId` or null | `HomePageClient` spotlight filter | Invalid theme → ignored |
| Client spotlight | `/api/funds/scores` fetch | catch → null | `normalizeScoredResponse` in client-data | discoveryActive scopes | Pool size vs universe | Timeout empty vs “no funds” confusion |

**Crash/degrade hotspots:** Theme `fundMatchesTheme` + `normalizeText` (fixed). Discovery rail `normalizeTr(c.name)` (fixed). Remaining: client-only fetch paths still rely on `normalizeScoredResponse` in `client-data` (unchanged, central).

---

## 2. Homepage total count (“180 vs evren”)

| Stage | Source | Fallback | Normalize | Semantic decision | UI assumption | Risk |
|-------|--------|----------|-----------|-------------------|---------------|------|
| True universe | `resolveHomepageTrueUniverseTotal` (`homepage-fund-counts.ts`) | market snapshot when canonical; never `funds.length` as universe | Resolution `known` \| `unknown` | `exploreUniverseTotal` only when `known` | `MarketHeader` + table `referenceUniverseTotal` | Conflating preview rows with total (guarded in resolver + `total: 0` on serving preview) |
| Evidence | `buildHomepageTotalsEvidence` + `formatHomepageTotalsEvidenceLog` | — | Structured log line | `scoresRowSource`, `rawScoresTotal` | Ops only | Mis-read logs |

**Contract:** `HomepageTotalsSemanticContract` + `HomepageDiscoverySurfaceState` in `src/lib/data-flow/contracts.ts` document fields; logic remains in `homepage-fund-counts.ts` (no fake totals).

---

## 3. Fund detail core

| Stage | Source | Fallback | Normalize | Semantic decision | UI assumption | Risk |
|-------|--------|----------|-----------|-------------------|---------------|------|
| Payload | `fund-detail-orchestrator` / serving file / DB | degraded branches | Multiple services | Phase1/phase2, `degraded` flags | `FundDetail*` components | Raw `fund.code` null → `.trim` in various services (partially guarded elsewhere) |

**Contract (typed, forward):** `DetailSurfaceState` in `contracts.ts` — UI should consume orchestrator rollup; full UI migration not in this pass.

---

## 4. Detail comparison summary

| Stage | Source | Fallback | Normalize | Semantic decision | UI assumption | Risk |
|-------|--------|----------|-----------|-------------------|---------------|------|
| Summary | `fund-detail-comparison-summary-contract` + chart branches | degraded copy | Contract module | `ready` vs degraded reasons | Smoke DOM asserts | Empty grid branch vs “öncelikli net fark” (addressed historically) |

**Contract:** `CompareDetailSummaryState` placeholder enum in `contracts.ts` aligned with existing contract file names.

---

## 5. Market summary

| Stage | Source | Fallback | Normalize | Semantic decision | UI assumption | Risk |
|-------|--------|----------|-----------|-------------------|---------------|------|
| SSR | `getMarketSummaryFromDailySnapshotSafe` | null → `deriveMarketSummaryFromServingRows` | `MarketHeader` uses `normalizeMarketApi` | `snapshotFundCountIsCanonicalUniverse` | Explore vs snapshot counts | Partial payload missing `summary` (guarded on page for tone) |

---

## 6. Compare API dependencies

| Stage | Source | Fallback | Normalize | Semantic decision | UI assumption | Risk |
|-------|--------|----------|-----------|-------------------|---------------|------|
| Route | DB + serving lists | degraded JSON success | Route handlers | `degraded` headers | Client compare page | Insufficient funds vs success |

**Contract:** `CompareSurfaceState` in `contracts.ts` for explicit degraded taxonomy (route wiring incremental).

---

## Central boundary (this pass)

**Server:** `src/app/page.tsx` → `prepareHomepageScoresPreview`, `normalizeHomepageCategoryList`, `deriveHomepageDiscoverySurfaceState`, optional `logHomepageDataFlowEvidence`.  
**Types:** `src/lib/data-flow/contracts.ts`.  
**Tests:** `src/lib/data-flow/homepage-boundary.test.ts`.

import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveHomepageDiscoverySurfaceState,
  prepareHomepageCategoriesForClient,
  prepareHomepageScoresPreviewAtBoundary,
} from "@/lib/data-flow/homepage-boundary";
import type { ScoredResponse } from "@/types/scored-funds";

test("prepareHomepageScoresPreviewAtBoundary null güvenli", () => {
  assert.equal(prepareHomepageScoresPreviewAtBoundary(null), null);
});

test("normalizeHomepageCategoryList null name satırını düşürür", () => {
  const { categories, rejectedRows } = prepareHomepageCategoriesForClient([
    { code: "PPF", name: null as unknown as string },
    { code: "HSF", name: "Hisse Senedi Fonu" },
  ]);
  assert.equal(rejectedRows, 1);
  assert.equal(categories.length, 1);
  assert.equal(categories[0]?.code, "HSF");
});

test("deriveHomepageDiscoverySurfaceState: kategori yok → degraded_missing_categories", () => {
  const st = deriveHomepageDiscoverySurfaceState({
    categoryCount: 0,
    scoresPreview: { mode: "BEST", total: 10, funds: [{ fundId: "1", code: "A", name: "N", shortName: null, logoUrl: null, lastPrice: 1, dailyReturn: 0, portfolioSize: 1, investorCount: 0, category: null, fundType: null, finalScore: null }] },
    categoryRejectedRows: 0,
  });
  assert.equal(st.kind, "degraded_missing_categories");
});

test("deriveHomepageDiscoverySurfaceState: skor satırı yok → degraded_empty_result", () => {
  const st = deriveHomepageDiscoverySurfaceState({
    categoryCount: 2,
    scoresPreview: { mode: "BEST", total: 0, funds: [] },
    categoryRejectedRows: 0,
    preNormalizationFundCount: 0,
  });
  assert.equal(st.kind, "degraded_empty_result");
  if (st.kind === "degraded_empty_result") assert.equal(st.reason, "empty_scores_row_list");
});

test("prepareHomepageScoresPreviewAtBoundary bozuk fon satırlarını süzger; tamamen boşsa empty_result yüzeyi", () => {
  const raw = {
    mode: "BEST",
    total: 2,
    funds: [
      { fundId: "", code: "", name: "x", shortName: null, logoUrl: null, lastPrice: 0, dailyReturn: 0, portfolioSize: 0, investorCount: 0, category: null, fundType: null, finalScore: null },
    ],
  } as unknown as ScoredResponse;
  const out = prepareHomepageScoresPreviewAtBoundary(raw);
  assert.ok(out);
  assert.equal(out!.funds.length, 0);
  const st = deriveHomepageDiscoverySurfaceState({
    categoryCount: 1,
    scoresPreview: out,
    categoryRejectedRows: 0,
    preNormalizationFundCount: 1,
  });
  assert.equal(st.kind, "degraded_empty_result");
  if (st.kind === "degraded_empty_result") assert.equal(st.reason, "normalization_removed_all_rows");
});

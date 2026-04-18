import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPARISON_SUMMARY_DEGRADED_NO_SECTION_LEAD,
  COMPARISON_SUMMARY_INSUFFICIENT_ROWS_LEAD,
  FUND_DETAIL_COMPARISON_SUMMARY_SMOKE_SUBSTRING,
  comparisonSummaryCopyIncludesSmokeToken,
  resolveFundDetailComparisonSummaryPanelState,
} from "./fund-detail-comparison-summary-contract";

test("resolveFundDetailComparisonSummaryPanelState covers gate paths", () => {
  assert.equal(
    resolveFundDetailComparisonSummaryPanelState({
      shouldRenderComparisonSection: false,
      comparisonRowCount: 0,
    }),
    "degraded_no_comparison_section"
  );
  assert.equal(
    resolveFundDetailComparisonSummaryPanelState({
      shouldRenderComparisonSection: true,
      comparisonRowCount: 0,
    }),
    "degraded_insufficient_rows"
  );
  assert.equal(
    resolveFundDetailComparisonSummaryPanelState({
      shouldRenderComparisonSection: true,
      comparisonRowCount: 3,
    }),
    "ready"
  );
});

test("degraded / insufficient copy always includes prodlike smoke substring", () => {
  assert.ok(comparisonSummaryCopyIncludesSmokeToken(COMPARISON_SUMMARY_DEGRADED_NO_SECTION_LEAD));
  assert.ok(comparisonSummaryCopyIncludesSmokeToken(COMPARISON_SUMMARY_INSUFFICIENT_ROWS_LEAD));
  assert.ok(FUND_DETAIL_COMPARISON_SUMMARY_SMOKE_SUBSTRING.length > 0);
});

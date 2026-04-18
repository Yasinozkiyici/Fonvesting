import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPARISON_SUMMARY_DEGRADED_NO_SECTION_LEAD,
  COMPARISON_SUMMARY_INSUFFICIENT_ROWS_LEAD,
  FUND_DETAIL_COMPARISON_SUMMARY_SMOKE_SUBSTRING,
  comparisonSummaryCopyIncludesSmokeToken,
  resolveFundDetailComparisonSummaryPanelState,
  validateFundDetailComparisonSummaryState,
} from "./fund-detail-comparison-summary-contract";

test("resolveFundDetailComparisonSummaryPanelState covers gate paths", () => {
  assert.equal(
    resolveFundDetailComparisonSummaryPanelState({
      shouldRenderComparisonSection: false,
      comparisonRowCount: 0,
      meaningfulComparableRowCount: 0,
    }),
    "degraded_no_comparison_section"
  );
  assert.equal(
    resolveFundDetailComparisonSummaryPanelState({
      shouldRenderComparisonSection: true,
      comparisonRowCount: 0,
      meaningfulComparableRowCount: 0,
    }),
    "degraded_insufficient_rows"
  );
  assert.equal(
    resolveFundDetailComparisonSummaryPanelState({
      shouldRenderComparisonSection: true,
      comparisonRowCount: 3,
      meaningfulComparableRowCount: 3,
    }),
    "ready"
  );
  assert.equal(
    resolveFundDetailComparisonSummaryPanelState({
      shouldRenderComparisonSection: true,
      comparisonRowCount: 6,
      meaningfulComparableRowCount: 0,
    }),
    "degraded_insufficient_rows"
  );
});

test("degraded / insufficient copy always includes prodlike smoke substring", () => {
  assert.ok(comparisonSummaryCopyIncludesSmokeToken(COMPARISON_SUMMARY_DEGRADED_NO_SECTION_LEAD));
  assert.ok(comparisonSummaryCopyIncludesSmokeToken(COMPARISON_SUMMARY_INSUFFICIENT_ROWS_LEAD));
  assert.ok(FUND_DETAIL_COMPARISON_SUMMARY_SMOKE_SUBSTRING.length > 0);
});

test("validateFundDetailComparisonSummaryState catches ready/degraded drift", () => {
  const invalidReady = validateFundDetailComparisonSummaryState({
    panelState: "ready",
    shouldRenderComparisonSection: false,
    comparisonRowCount: 0,
    meaningfulComparableRowCount: 0,
    degradedReasonAttr: "ready",
  });
  assert.equal(invalidReady.valid, false);

  const invalidReason = validateFundDetailComparisonSummaryState({
    panelState: "degraded_insufficient_rows",
    shouldRenderComparisonSection: true,
    comparisonRowCount: 0,
    meaningfulComparableRowCount: 0,
    degradedReasonAttr: "ready",
  });
  assert.equal(invalidReason.valid, false);

  const valid = validateFundDetailComparisonSummaryState({
    panelState: "degraded_no_comparison_section",
    shouldRenderComparisonSection: false,
    comparisonRowCount: 0,
    meaningfulComparableRowCount: 0,
    degradedReasonAttr: "degraded_no_comparison_section",
  });
  assert.equal(valid.valid, true);
});

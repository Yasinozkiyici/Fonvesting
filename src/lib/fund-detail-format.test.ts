import test from "node:test";
import assert from "node:assert/strict";
import {
  formatChartAxisPercentTick,
  formatChartAxisPriceTick,
  formatDetailAbsolutePercent,
  formatDetailDeltaPercent,
  formatDetailNavPrice,
  formatDetailSignedPercent,
  formatDetailTrendWindowDeltaPercent,
  formatTrendCardNumeric,
} from "@/lib/fund-detail-format";

test("fund-detail-format: NAV / eksen etiketleri", () => {
  assert.equal(formatDetailNavPrice(12.3), "12,30");
  assert.equal(formatDetailNavPrice(0.787635), "0,7876");
  assert.match(formatChartAxisPriceTick(1234.56), /1/);
  assert.equal(formatChartAxisPercentTick(12.345), "12,3%");
  assert.equal(formatChartAxisPercentTick(-3.891), "-3,9%");
});

test("fund-detail-format: yüzde ve net fark", () => {
  assert.equal(formatDetailSignedPercent(1.2), "+1,20%");
  assert.equal(formatDetailSignedPercent(-0.5), "-0,50%");
  assert.equal(formatDetailAbsolutePercent(-2.34), "-2,34%");
  assert.equal(formatDetailDeltaPercent(1.204, 0.15), "+1,20%");
  assert.equal(formatDetailDeltaPercent(0.1, 0.15), "0,00%");
});

test("fund-detail-format: trend penceresi delta ve hassas sayı", () => {
  assert.equal(formatDetailTrendWindowDeltaPercent(2_155_000, 2_175_000, "count"), "+0,93%");
  assert.equal(formatDetailTrendWindowDeltaPercent(0.5, 100, "count"), null);
  assert.equal(formatDetailTrendWindowDeltaPercent(1, 2_000_000, "count"), null);
  assert.match(formatTrendCardNumeric(2_155_000, "count", 2_120_000, 2_180_000), /2\.?155/);
  assert.match(formatTrendCardNumeric(2_175_000, "count", 2_120_000, 2_180_000), /2\.?175/);
});

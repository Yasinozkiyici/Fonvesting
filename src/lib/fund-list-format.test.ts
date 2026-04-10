import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCompactCurrency,
  formatCompactNumber,
  formatFundLastPrice,
  fundDisplaySubtitle,
} from "@/lib/fund-list-format";

test("fund-list-format helpers keep finance formatting stable", () => {
  assert.equal(formatCompactNumber(0), "—");
  assert.equal(formatCompactNumber(2_000_000), "2.0M");
  assert.equal(formatCompactCurrency(1_250_000_000), "₺1.3Mr");
  assert.equal(formatFundLastPrice(0.787635), "0,787635");
  assert.equal(
    fundDisplaySubtitle({
      code: "VGA",
      name: "Türkiye Hayat ve Emeklilik Altın Katılım Fonu",
      shortName: "Türkiye Hayat Altın",
    }),
    "Türkiye Hayat Altın"
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { fundSearchMatches, normalizeFundSearchText } from "@/lib/fund-search";
import type { ScoresApiPayload } from "@/lib/services/fund-scores-types";

function payload(): ScoresApiPayload {
  return {
    mode: "BEST",
    total: 3,
    funds: [
      {
        fundId: "1",
        code: "TI1",
        name: "İŞ PORTFÖY PARA PİYASASI (TL) FONU",
        shortName: "İş Portföy Para Piyasası",
        logoUrl: null,
        lastPrice: 1,
        dailyReturn: 0,
        portfolioSize: 1,
        investorCount: 1,
        category: { code: "PPF", name: "Para Piyasası" },
        fundType: null,
        finalScore: null,
      },
      {
        fundId: "2",
        code: "ZP8",
        name: "ZİRAAT PORTFÖY PARA PİYASASI FONU",
        shortName: "Ziraat Para",
        logoUrl: null,
        lastPrice: 1,
        dailyReturn: 0,
        portfolioSize: 1,
        investorCount: 1,
        category: { code: "PPF", name: "Para Piyasası" },
        fundType: null,
        finalScore: null,
      },
      {
        fundId: "3",
        code: "VGA",
        name: "VAKIF PORTFÖY ALTIN FONU",
        shortName: null,
        logoUrl: null,
        lastPrice: 1,
        dailyReturn: 0,
        portfolioSize: 1,
        investorCount: 1,
        category: { code: "ALT", name: "Altın" },
        fundType: null,
        finalScore: null,
      },
    ],
  };
}

test("fund search normalization folds Turkish letters and punctuation", () => {
  assert.equal(normalizeFundSearchText(" İŞ PORTFÖY, Para PİYASASI "), "is portfoy para piyasasi");
  assert.equal(fundSearchMatches("is portfoy para", ["İŞ PORTFÖY PARA PİYASASI (TL) FONU"]), true);
  assert.equal(fundSearchMatches("  zp8  ", ["ZP8", "Ziraat Portföy Para Piyasası"]), true);
});

test("scores query filter finds real funds by ASCII Turkish name and code", () => {
  const byName = payload().funds.filter((fund) =>
    fundSearchMatches("is portfoy para", [fund.code, fund.name, fund.shortName])
  );
  assert.equal(byName.length, 1);
  assert.equal(byName[0]!.code, "TI1");

  const byCode = payload().funds.filter((fund) =>
    fundSearchMatches("zp8", [fund.code, fund.name, fund.shortName])
  );
  assert.equal(byCode.length, 1);
  assert.equal(byCode[0]!.code, "ZP8");
});

test("scores query filter only returns valid empty when there is a real no-match", () => {
  const none = payload().funds.filter((fund) =>
    fundSearchMatches("bu fon yok", [fund.code, fund.name, fund.shortName])
  );
  assert.equal(none.length, 0);
});

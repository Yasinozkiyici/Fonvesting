import test from "node:test";
import assert from "node:assert/strict";
import { servingHomeRowHasPublishableCode } from "./fund-detail-core-serving-row-guard";

test("servingHomeRowHasPublishableCode rejects unsafe homepage row codes", () => {
  assert.equal(servingHomeRowHasPublishableCode({ code: "VGA" }), true);
  assert.equal(servingHomeRowHasPublishableCode({ code: "  TI1  " }), true);
  assert.equal(servingHomeRowHasPublishableCode({ code: "" }), false);
  assert.equal(servingHomeRowHasPublishableCode({ code: "   " }), false);
  assert.equal(servingHomeRowHasPublishableCode({ code: undefined as unknown as string }), false);
  assert.equal(servingHomeRowHasPublishableCode({ code: null as unknown as string }), false);
});

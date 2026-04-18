import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFundDetailPayloadAtBoundary } from "@/lib/data-flow/detail-boundary";

const basePayload = {
  fund: { code: "VGA", name: "VGA Fon" },
  priceSeries: [
    { t: 1_700_000_000_000, p: 10 },
    { t: 1_700_086_400_000, p: 10.2 },
  ],
  similarFunds: [],
  trendSeries: { investorCount: [], portfolioSize: [] },
  kiyasBlock: {
    rowsByRef: {
      category: [{ periodId: "1y", fundPct: 12, refPct: 9 }],
    },
  },
};

test("detail boundary rejects malformed/null payload", () => {
  const out = normalizeFundDetailPayloadAtBoundary(null);
  assert.equal(out.surfaceState.kind, "degraded_invalid_payload");
  assert.equal(out.payload, null);
});

test("detail boundary marks missing comparison as explicit degraded state", () => {
  const out = normalizeFundDetailPayloadAtBoundary({
    ...basePayload,
    kiyasBlock: null,
  });
  assert.equal(out.surfaceState.kind, "degraded_no_comparison_section");
  assert.ok(out.payload);
});

test("detail boundary marks insufficient comparison rows explicitly", () => {
  const out = normalizeFundDetailPayloadAtBoundary({
    ...basePayload,
    kiyasBlock: { rowsByRef: { category: [{ periodId: "1y", fundPct: null, refPct: null }] } },
  });
  assert.equal(out.surfaceState.kind, "degraded_insufficient_rows");
});

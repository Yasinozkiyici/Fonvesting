import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSparklineResponse } from "@/lib/client-data";

test("normalizeSparklineResponse filters invalid entries safely", () => {
  const normalized = normalizeSparklineResponse({
    ok: true,
    items: {
      XU100: { points: [1, 2, Number.NaN, 4], trend: "up" },
      BROKEN: { points: "x", trend: "weird" },
    },
  });

  assert.deepEqual(normalized, {
    ok: true,
    items: {
      XU100: { points: [1, 2, 4], trend: "up" },
    },
  });
});

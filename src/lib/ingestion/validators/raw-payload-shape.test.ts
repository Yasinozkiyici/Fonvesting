import test from "node:test";
import assert from "node:assert/strict";
import { assertRawPricePayloadRows } from "@/lib/ingestion/validators/raw-payload-shape";

test("assertRawPricePayloadRows accepts valid rows", () => {
  const rows = assertRawPricePayloadRows("prices", [
    { code: "vga", date: "2026-04-17", price: 123.45 },
    { code: "ti1", date: new Date("2026-04-16T00:00:00.000Z"), price: 98.7 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.code, "VGA");
  assert.equal(rows[1]?.code, "TI1");
});

test("assertRawPricePayloadRows rejects malformed rows", () => {
  assert.throws(
    () =>
      assertRawPricePayloadRows("prices", [
        { code: "VGA", date: "invalid-date", price: 12 },
      ]),
    /prices_row_0_invalid_date/
  );
  assert.throws(
    () =>
      assertRawPricePayloadRows("prices", [
        { code: "", date: "2026-04-17", price: 12 },
      ]),
    /prices_row_0_missing_code/
  );
});

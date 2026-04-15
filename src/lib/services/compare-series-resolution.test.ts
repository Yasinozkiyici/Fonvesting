import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBaseCode,
  parseCompareCodes,
  readServingPayloadForCompareSeries,
  isTransientCompareBaseMissReason,
  classifyCompareBaseAvailability,
  classifyRegistryProofAvailability,
  type CompareServingReaderLike,
} from "@/lib/services/compare-series-resolution";

type Payload = { code: string };

async function resolveForTest(
  baseRaw: string,
  codesRaw: string,
  reader: CompareServingReaderLike<Payload>
): Promise<{ ok: true; base: Payload; peers: Payload[] } | { ok: false; error: "base_not_found" }> {
  const baseCode = normalizeBaseCode(baseRaw);
  const compareCodes = parseCompareCodes(codesRaw).filter((code) => code !== baseCode);
  const baseRead = await readServingPayloadForCompareSeries(baseCode, reader);
  if (!baseRead.payload) return { ok: false, error: "base_not_found" };
  const peers: Payload[] = [];
  for (const code of compareCodes) {
    const read = await readServingPayloadForCompareSeries(code, reader);
    if (read.payload) peers.push(read.payload);
  }
  return { ok: true, base: baseRead.payload, peers };
}

test("code normalization (trim/case) is deterministic", () => {
  assert.equal(normalizeBaseCode("  vga "), "VGA");
  assert.equal(normalizeBaseCode("Ti1"), "TI1");
  assert.equal(normalizeBaseCode("$$$"), "");
  assert.deepEqual(parseCompareCodes(" ti1, zP8, bad-!, ti1 "), ["TI1", "ZP8"]);
});

test("valid base + empty codes does not produce base_not_found", async () => {
  const reader: CompareServingReaderLike<Payload> = async (code) => ({
    payload: { code },
    missReason: null,
  });
  const result = await resolveForTest("vga", "", reader);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.base.code, "VGA");
    assert.equal(result.peers.length, 0);
  }
});

test("valid base + one valid compare code succeeds", async () => {
  const reader: CompareServingReaderLike<Payload> = async (code) => ({
    payload: { code },
    missReason: null,
  });
  const result = await resolveForTest("VGA", "ti1", reader);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.base.code, "VGA");
    assert.deepEqual(result.peers.map((peer) => peer.code), ["TI1"]);
  }
});

test("invalid base returns base_not_found", async () => {
  const reader: CompareServingReaderLike<Payload> = async () => ({
    payload: null,
    missReason: "db_miss",
  });
  const result = await resolveForTest("NOPE1", "TI1", reader);
  assert.deepEqual(result, { ok: false, error: "base_not_found" });
});

test("file-only miss falls back to durable read path", async () => {
  const calls: Array<{ code: string; preferFileOnly: boolean }> = [];
  const reader: CompareServingReaderLike<Payload> = async (code, options) => {
    calls.push({ code, preferFileOnly: Boolean(options?.preferFileOnly) });
    if (options?.preferFileOnly) {
      return { payload: null, missReason: "file_missing" };
    }
    return { payload: { code }, missReason: null };
  };
  const read = await readServingPayloadForCompareSeries("VGA", reader);
  assert.deepEqual(read.payload, { code: "VGA" });
  assert.deepEqual(calls, [
    { code: "VGA", preferFileOnly: true },
    { code: "VGA", preferFileOnly: false },
  ]);
});

test("transient base miss reason classification is deterministic", () => {
  assert.equal(isTransientCompareBaseMissReason("read_timeout"), true);
  assert.equal(isTransientCompareBaseMissReason("ondemand_failed"), true);
  assert.equal(isTransientCompareBaseMissReason("db_miss"), false);
  assert.equal(isTransientCompareBaseMissReason(null), false);
});

test("base availability classification separates temporary failures from not_found", () => {
  assert.equal(
    classifyCompareBaseAvailability({ hasPayload: true, matchedFromUniverse: false, missReason: "db_miss" }),
    "ok"
  );
  assert.equal(
    classifyCompareBaseAvailability({ hasPayload: false, matchedFromUniverse: true, missReason: "db_miss" }),
    "ok"
  );
  assert.equal(
    classifyCompareBaseAvailability({ hasPayload: false, matchedFromUniverse: false, missReason: "read_timeout" }),
    "temporarily_unavailable"
  );
  assert.equal(
    classifyCompareBaseAvailability({ hasPayload: false, matchedFromUniverse: false, missReason: "db_miss" }),
    "not_found"
  );
});

test("registry proof makes invalid base deterministic when a durable source answered", () => {
  assert.equal(classifyRegistryProofAvailability({ rowExists: true, source: "rest" }), "ok");
  assert.equal(classifyRegistryProofAvailability({ rowExists: false, source: "rest" }), "not_found");
  assert.equal(classifyRegistryProofAvailability({ rowExists: false, source: "prisma" }), "not_found");
  assert.equal(classifyRegistryProofAvailability({ rowExists: false, source: "none" }), "unknown");
});

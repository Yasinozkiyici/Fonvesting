import test from "node:test";
import assert from "node:assert/strict";
import { shouldRenderSectionFromContract } from "@/lib/fund-detail-section-status";

test("renderable payload coarse false olsa da section render edilir", () => {
  assert.equal(shouldRenderSectionFromContract(false, true), true);
});

test("fallback yalnız coarse=false ve payload render edilemezken çalışır", () => {
  assert.equal(shouldRenderSectionFromContract(false, false), false);
});

test("coarse true ise payload olmasa da section render edilir", () => {
  assert.equal(shouldRenderSectionFromContract(true, false), true);
});


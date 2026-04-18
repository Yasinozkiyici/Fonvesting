import test from "node:test";
import assert from "node:assert/strict";
import { resolveServingWorldFromBuildIds } from "@/lib/domain/serving/world-id";

test("resolveServingWorldFromBuildIds marks aligned world", () => {
  const world = resolveServingWorldFromBuildIds({
    fundList: "build-123",
    fundDetail: "build-123",
    compare: "build-123",
    discovery: "build-123",
    system: "build-123",
  });
  assert.equal(world.worldId, "build-123");
  assert.equal(world.worldAligned, true);
});

test("resolveServingWorldFromBuildIds marks misalignment", () => {
  const world = resolveServingWorldFromBuildIds({
    fundList: "build-a",
    fundDetail: "build-b",
    compare: null,
    discovery: "build-a",
    system: null,
  });
  assert.equal(world.worldId, "build-a");
  assert.equal(world.worldAligned, false);
});

test("resolveServingWorldFromBuildIds handles empty heads", () => {
  const world = resolveServingWorldFromBuildIds({
    fundList: null,
    fundDetail: null,
    compare: null,
    discovery: null,
    system: null,
  });
  assert.equal(world.worldId, null);
  assert.equal(world.worldAligned, false);
});


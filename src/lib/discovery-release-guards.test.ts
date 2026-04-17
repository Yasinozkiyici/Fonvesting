import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { thematicRailOptions } from "@/lib/tefas-discovery-rail";

test("thematic rail exposes valid theme ids for every subgroup", () => {
  const ids = thematicRailOptions().map((option) => option.id);
  assert.deepEqual(ids, [
    "blockchain",
    "green_energy",
    "technology",
    "health_biotech",
    "artificial_intelligence",
    "precious_metals",
    "defense",
  ]);
  assert.equal(new Set(ids).size, ids.length);
});

test("scores route runtime cache key is scoped by query and theme", () => {
  const source = fs.readFileSync(path.resolve("src/app/api/funds/scores/route.ts"), "utf8");
  assert.match(source, /function responseScoresKey\(/);
  assert.match(source, /theme:\$\{theme \?\? "none"\}/);
  assert.match(source, /q:\$\{normalizedQuery \|\| "none"\}/);
  assert.doesNotMatch(
    source,
    /if \(payload\.funds\.length > 0 && nextCacheState !== "stale"\) {\s*state\.cache\.set\(key/s,
    "scoped fallback payloads must not be written before final query/theme filtering"
  );
});

test("scores route does not short-circuit filtered requests to funds-list fallback before snapshot", () => {
  const source = fs.readFileSync(path.resolve("src/app/api/funds/scores/route.ts"), "utf8");
  assert.doesNotMatch(
    source,
    /if \(!handledByCriticalPath && queryTrim && !theme\)\s*\{\s*const fundsListFallback/s,
    "query-filtered requests must not stop at funds-list fallback before snapshot path"
  );
  assert.doesNotMatch(
    source,
    /if \(!handledByCriticalPath && categoryCode\)[\s\S]*?readFundsListFallback/s,
    "category-filtered requests must not short-circuit to funds-list before primary snapshot resolution"
  );
});

test("discovery UI exposes stable invisible hooks for release smoke", () => {
  const home = fs.readFileSync(path.resolve("src/components/home/HomePageClient.tsx"), "utf8");
  const table = fs.readFileSync(path.resolve("src/components/tefas/ScoredFundsTable.tsx"), "utf8");
  const row = fs.readFileSync(path.resolve("src/components/ds/FundRow.tsx"), "utf8");

  assert.match(home, /data-discovery-root="true"/);
  assert.match(home, /data-discovery-primary-option=/);
  assert.match(home, /data-discovery-secondary-option=/);
  assert.match(table, /data-discovery-result-list="true"/);
  assert.match(table, /data-discovery-empty-state=/);
  assert.match(row, /data-discovery-row="true"/);
});

test("scores client fetches are deduped by URL for rapid discovery interactions", () => {
  const source = fs.readFileSync(path.resolve("src/lib/client-data.ts"), "utf8");
  assert.match(source, /const sharedScoresFetches = new Map/);
  assert.match(source, /const sharedScoresSettled = new Map/);
  assert.match(source, /SHARED_SCORES_SETTLED_TTL_MS/);
  assert.match(source, /sortedParams/);
  assert.ok(source.includes('parsed.pathname !== "/api/funds/scores"'));
  assert.match(source, /return existing/);
});

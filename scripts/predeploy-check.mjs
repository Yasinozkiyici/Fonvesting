import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (process.env[key]) continue;
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(path.resolve(".env.local"));
loadEnvFile(path.resolve(".env"));

const required = [
  "DATABASE_URL",
  "DIRECT_URL",
  "CRON_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY",
  "SERVING_REBUILD_WORKER_WEBHOOK_URL",
  "SERVING_REBUILD_WORKER_TOKEN",
];
const missing = required.filter((key) => !process.env[key] || String(process.env[key]).trim() === "");

if (missing.length > 0) {
  console.error("Eksik environment variable:", missing.join(", "));
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL ? String(process.env.DATABASE_URL).trim() : "";
if (dbUrl && !dbUrl.startsWith("postgresql:") && !dbUrl.startsWith("postgres:")) {
  console.error("DATABASE_URL PostgreSQL olmalı (postgresql://... veya postgres://...). SQLite (file:) artık desteklenmiyor.");
  process.exit(1);
}

function parseEnvKeys(filePath) {
  if (!fs.existsSync(filePath)) return new Set();
  const raw = fs.readFileSync(filePath, "utf8");
  const keys = new Set();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (key) keys.add(key);
  }
  return keys;
}

const envExampleKeys = parseEnvKeys(path.resolve(".env.example"));
const envLocalExampleKeys = parseEnvKeys(path.resolve(".env.local.example"));
const missingInLocalExample = [...envExampleKeys].filter((key) => !envLocalExampleKeys.has(key));
const missingInExample = [...envLocalExampleKeys].filter((key) => !envExampleKeys.has(key));
if (missingInLocalExample.length || missingInExample.length) {
  if (missingInLocalExample.length) {
    console.error(".env.local.example içinde eksik key(ler):", missingInLocalExample.join(", "));
  }
  if (missingInExample.length) {
    console.error(".env.example içinde eksik key(ler):", missingInExample.join(", "));
  }
  process.exit(1);
}

function readProjectFile(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function assertContains(fileLabel, content, token, message) {
  if (!content.includes(token)) {
    console.error(`${fileLabel}: ${message}`);
    process.exit(1);
  }
}

function assertOrder(fileLabel, content, first, second, message) {
  const firstIndex = content.indexOf(first);
  const secondIndex = content.indexOf(second);
  if (firstIndex === -1 || secondIndex === -1 || firstIndex >= secondIndex) {
    console.error(`${fileLabel}: ${message}`);
    process.exit(1);
  }
}

const compareRoute = readProjectFile("src/app/api/funds/compare/route.ts");
assertOrder(
  "src/app/api/funds/compare/route.ts",
  compareRoute,
  "let rows = await loadRowsFromServing(codes)",
  "rows = await loadRowsFromSnapshot(codes)",
  "compare critical path must stay serving/cache-first before Prisma snapshot fallback."
);
assertContains(
  "src/app/api/funds/compare/route.ts",
  compareRoute,
  "context_optional_skipped",
  "compare enrichment must remain optional when a usable serving payload is available."
);

const compareSeriesRoute = readProjectFile("src/app/api/funds/compare-series/route.ts");
assertContains(
  "src/app/api/funds/compare-series/route.ts",
  compareSeriesRoute,
  "classifyRegistryProofAvailability",
  "compare-series must keep durable registry proof for invalid-base semantics."
);
assertContains(
  "src/app/api/funds/compare-series/route.ts",
  compareSeriesRoute,
  "base_not_found",
  "compare-series must keep deterministic base_not_found handling."
);
assertContains(
  "src/app/api/funds/compare-series/route.ts",
  compareSeriesRoute,
  "optionalReferenceDegradation",
  "macro/reference degradation must stay explicitly optional."
);
assertContains(
  "src/app/api/funds/compare-series/route.ts",
  compareSeriesRoute,
  "macroCooldownUntil",
  "compare-series macro timeout must use a cooldown so repeated optional enrichment failures do not slow user-critical series."
);

const scoresRoute = readProjectFile("src/app/api/funds/scores/route.ts");
assertOrder(
  "src/app/api/funds/scores/route.ts",
  scoresRoute,
  "readPersistedScoresPayloadFromRest",
  "prisma.scoresApiCache.findUnique",
  "scores persisted cache must try REST before direct Prisma."
);
assertOrder(
  "src/app/api/funds/scores/route.ts",
  scoresRoute,
  "const servingFallback = await readCoreServingScoresFallback",
  "const fundsListFallback = await readFundsListFallback",
  "scores critical fallback must try serving/core cache before funds-list DB fallback."
);
assertContains(
  "src/app/api/funds/scores/route.ts",
  scoresRoute,
  'source: "snapshot" | "memory" | "stale" | "db-cache" | "light" | "funds-list" | "empty"',
  "scores source headers must expose memory/serving/cache fallback source."
);

const healthRoute = readProjectFile("src/app/api/health/route.ts");
assertContains(
  "src/app/api/health/route.ts",
  healthRoute,
  "X-Health-Read-Path-Operational",
  "health must expose user-critical read-path readiness."
);
assertContains(
  "src/app/api/health/route.ts",
  healthRoute,
  "X-Health-Direct-Db-Failure-Class",
  "health must keep direct DB diagnostics separate from read-path readiness."
);

const detailService = readProjectFile("src/lib/services/fund-detail.service.ts");
assertContains(
  "src/lib/services/fund-detail.service.ts",
  detailService,
  'process.env.FUND_DETAIL_CORE_SERVING_FILE_ONLY === "1"',
  "detail serving must not default to local file-only cache in production."
);

const systemHealth = readProjectFile("src/lib/system-health.ts");
assertContains(
  "src/lib/system-health.ts",
  systemHealth,
  "shouldRunExternalDbFailureProbes({ includeExternalProbes, lightweight })",
  "light health must not run DNS/TCP probes after an expected direct DB diagnostic miss."
);
assertContains(
  "src/lib/system-health.ts",
  systemHealth,
  'dbPing.source !== "cache_failed"',
  "cached direct DB diagnostic failures must not spam health degraded logs."
);

const prismaClient = readProjectFile("src/lib/prisma.ts");
assertContains(
  "src/lib/prisma.ts",
  prismaClient,
  '{ emit: "event", level: "error" }',
  "production Prisma errors must use normalized event logging instead of raw prisma:error stdout."
);

console.log("Predeploy check başarılı.");

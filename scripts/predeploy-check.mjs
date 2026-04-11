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

console.log("Predeploy check başarılı.");

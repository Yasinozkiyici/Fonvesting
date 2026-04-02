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

loadEnvFile(path.resolve(".env"));
loadEnvFile(path.resolve(".env.local"));

// CI ortamında bazen DATABASE_URL secret'ı boş gelebiliyor. Predeploy check'i
// sadece kritik olan CRON_SECRET için çalıştırıp, DATABASE_URL yoksa uyarı basıyoruz.
const required = ["CRON_SECRET"];
const missing = required.filter((key) => !process.env[key] || String(process.env[key]).trim() === "");

if (missing.length > 0) {
  console.error("Eksik environment variable:", missing.join(", "));
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL ? String(process.env.DATABASE_URL) : "";
if (dbUrl) {
  if (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
    console.error("DATABASE_URL PostgreSQL olmalı (postgresql://...)");
    process.exit(1);
  }
}

console.log("Predeploy check başarılı.");

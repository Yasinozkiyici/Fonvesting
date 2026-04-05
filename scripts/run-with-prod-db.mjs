#!/usr/bin/env node
/**
 * .env sonra .env.local ile DATABASE_URL’ü yükler (yerel sqlite .env’i ezer),
 * ardından verilen komutu çalıştırır.
 */
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env") });
config({ path: path.join(root, ".env.local"), override: true });

const [, , ...args] = process.argv;
if (args.length === 0) {
  console.error("Kullanım: node scripts/run-with-prod-db.mjs <komut> [args...]");
  process.exit(1);
}

let url = process.env.DATABASE_URL;
const direct = process.env.DIRECT_URL;
const isMigrate =
  args.length >= 3 &&
  args[0] === "pnpm" &&
  args[1] === "exec" &&
  args[2] === "prisma" &&
  args.includes("migrate");

if (isMigrate && direct && /^postgres(ql)?:\/\//i.test(direct)) {
  url = direct;
  console.error("[run-with-prod-db] migrate için DIRECT_URL (doğrudan Postgres) kullanılıyor.");
}

if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
  console.error("[run-with-prod-db] Geçerli postgresql DATABASE_URL yok (.env.local?).");
  process.exit(1);
}

const [cmd, ...cmdArgs] = args;
const r = spawnSync(cmd, cmdArgs, {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
  shell: false,
});
process.exit(r.status ?? 1);

import "../load-env";
import { execSync } from "node:child_process";
import path from "node:path";

/**
 * ~3 yıl TEFAS history + serving rebuild zinciri.
 * Uygulama: `scripts/sync-tefas-history.ts` (varsayılan --days 1095).
 */
async function main() {
  const root = path.resolve(__dirname, "../..");
  execSync("pnpm exec tsx scripts/sync-tefas-history.ts --days 1095", {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  execSync("pnpm exec tsx scripts/data-platform/rebuild-serving.ts", {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  execSync("pnpm exec tsx scripts/data-platform/verify.ts", {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import "../load-env";
import { runDailyRecovery } from "../../src/lib/services/daily-recovery.service";

async function main() {
  const result = await runDailyRecovery();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

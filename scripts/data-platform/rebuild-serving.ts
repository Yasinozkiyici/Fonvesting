import "../load-env";
import { runServingRebuild } from "../../src/lib/services/serving-rebuild.service";

async function main() {
  const warm = process.argv.includes("--no-warm") ? false : true;
  const result = await runServingRebuild({ warmCaches: warm });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

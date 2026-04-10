import "./load-env";
import { runFullTefasSync, runTefasSync } from "../src/lib/services/tefas-sync.service";

const all = process.argv.includes("--all");

if (all) {
  runFullTefasSync()
    .then((r) => {
      console.log(JSON.stringify(r));
      process.exit(r.ok || r.skipped ? 0 : 1);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
} else {
  const code = process.argv.includes("--fund-type")
    ? Number(process.argv[process.argv.indexOf("--fund-type") + 1])
    : 0;

  runTefasSync({ fundTypeCode: Number.isFinite(code) ? code : 0 })
    .then((r) => {
      console.log(JSON.stringify(r));
      process.exit(r.ok || r.skipped ? 0 : 1);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

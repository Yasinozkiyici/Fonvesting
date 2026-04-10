import "./load-env";
import { getSystemHealthSnapshot } from "../src/lib/system-health";

async function main() {
  const strict = process.argv.includes("--strict");
  const snapshot = await getSystemHealthSnapshot();

  console.log(`[db:check] status=${snapshot.status} checkedAt=${snapshot.checkedAt}`);
  console.log(
    `[db:check] funds=${snapshot.counts.funds} active=${snapshot.counts.activeFunds} snapshots=${snapshot.counts.dailySnapshots} derived=${snapshot.counts.derivedMetrics}`
  );
  console.log(
    `[db:check] latestFundSnapshot=${snapshot.freshness.latestFundSnapshotDate ?? "none"} latestMarketSnapshot=${snapshot.freshness.latestMarketSnapshotDate ?? "none"} latestMacro=${snapshot.freshness.latestMacroObservationDate ?? "none"}`
  );

  if (snapshot.issues.length > 0) {
    console.log("[db:check] issues:");
    for (const issue of snapshot.issues) {
      console.log(`- [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
  }

  if (snapshot.errors.length > 0) {
    console.log("[db:check] errors:");
    for (const error of snapshot.errors) {
      console.log(`- ${error}`);
    }
  }

  if (!snapshot.ok || (strict && snapshot.issues.length > 0)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[db:check] failed", error);
  process.exit(1);
});

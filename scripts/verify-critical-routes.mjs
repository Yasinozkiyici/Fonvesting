import {
  CRITICAL_API_CONTRACTS,
  DEGRADED_SCENARIO_PROBES,
  SUPPORTING_PROBE_PATHS,
} from "./critical-path-contracts.mjs";
import { withSmokeAuthFetchOptions } from "./smoke-auth.mjs";

const baseUrl = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const timeoutMs = Number(process.env.VERIFY_TIMEOUT_MS || 25000);
const retries = Number(process.env.VERIFY_RETRY_COUNT || 1);
const retryDelayMs = Number(process.env.VERIFY_RETRY_DELAY_MS || 900);
const scenario = (process.env.VERIFY_SCENARIO || "normal").trim().toLowerCase();
const requireScenarioEvidence = process.env.VERIFY_REQUIRE_SCENARIOS === "1";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...withSmokeAuthFetchOptions({
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "x-health-secret": process.env.HEALTH_SECRET || "" },
    }),
  });
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`invalid_json status=${response.status}`);
  }
  return { response, payload };
}

async function runContractCheck(group, route) {
  let lastError = "unknown";
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const startedAt = Date.now();
      const { response, payload } = await fetchJson(route.path);
      const durationMs = Date.now() - startedAt;
      if (!response.ok) {
        throw new Error(`http_${response.status}`);
      }

      const nonEmptyOk = route.expectedNonEmpty(payload, response);
      const degradedOk = route.degradedContract(payload, response);
      const emptyOk = route.emptyAllowed(payload, response);
      const passByScenario = scenario === "degraded" ? degradedOk : nonEmptyOk || emptyOk;
      const failureScope = degradedOk ? "live-path-only" : "total-path";
      if (!passByScenario) {
        throw new Error(`contract_mismatch scope=${failureScope}`);
      }
      return {
        group: group.id,
        checkId: route.id,
        path: route.path,
        status: "PASS",
        durationMs,
        nonEmptyOk,
        degradedOk,
        emptyOk,
        failureScope: "none",
        failingContract: null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < retries) {
        console.warn(`[verify-critical] check=${route.id} retry=${attempt + 1}/${retries + 1} error=${lastError}`);
        await sleep(retryDelayMs);
        continue;
      }
    }
  }
  return {
    group: group.id,
    checkId: route.id,
    path: route.path,
    status: "FAIL",
    durationMs: null,
    nonEmptyOk: false,
    degradedOk: false,
    emptyOk: false,
    failureScope: lastError.includes("scope=live-path-only") ? "live-path-only" : "total-path",
    failingContract: lastError.includes("http_") ? `http_status:${lastError}` : lastError,
  };
}

function printContractResults(results) {
  console.log("\n=== Critical Path Contract Report ===");
  for (const row of results) {
    const bits = `nonEmpty=${row.nonEmptyOk ? "ok" : "no"} degraded=${row.degradedOk ? "ok" : "no"} empty=${row.emptyOk ? "ok" : "no"}`;
    const failBits = row.status === "FAIL"
      ? ` failing_contract=${row.failingContract} scope=${row.failureScope}`
      : "";
    console.log(
      `[${row.status}] group=${row.group} check=${row.checkId} path=${row.path} ${bits}${failBits}` +
        `${row.durationMs != null ? ` duration_ms=${row.durationMs}` : ""}`
    );
  }
}

async function runSupportingProbes() {
  const byPath = new Map();
  for (const path of SUPPORTING_PROBE_PATHS) {
    try {
      const { response, payload } = await fetchJson(path);
      byPath.set(path, { payload, headers: response.headers, status: response.status });
    } catch (error) {
      byPath.set(path, {
        payload: null,
        headers: new Headers(),
        status: -1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return byPath;
}

function printScenarioResults(rows) {
  console.log("\n=== Degraded Scenario Evidence ===");
  for (const row of rows) {
    console.log(
      `[${row.status}] scenario=${row.id} seen=${row.seen ? 1 : 0} reason=${row.reason} enforced=${row.enforced ? 1 : 0}`
    );
  }
}

const contractResults = [];
for (const group of CRITICAL_API_CONTRACTS) {
  for (const route of group.checks) {
    contractResults.push(await runContractCheck(group, route));
  }
}
printContractResults(contractResults);

const probeContext = { byPath: await runSupportingProbes() };
const scenarioResults = DEGRADED_SCENARIO_PROBES.map((scenarioDef) => {
  const outcome = scenarioDef.evidence(probeContext);
  const gateRequired = requireScenarioEvidence && scenarioDef.requiredForGate === true;
  const status = outcome.seen ? (outcome.pass ? "PASS" : "FAIL") : (gateRequired ? "FAIL" : "WARN");
  return {
    id: scenarioDef.id,
    description: scenarioDef.description,
    seen: outcome.seen,
    reason: outcome.reason,
    status,
    enforced: gateRequired,
    requiredForGate: scenarioDef.requiredForGate === true,
  };
});
printScenarioResults(scenarioResults);

const failedContractCount = contractResults.filter((row) => row.status === "FAIL").length;
const failedScenarioCount = scenarioResults.filter((row) => row.status === "FAIL").length;
const liveOnlyFailures = contractResults.filter(
  (row) => row.status === "FAIL" && row.failureScope === "live-path-only"
).length;
const totalPathFailures = contractResults.filter(
  (row) => row.status === "FAIL" && row.failureScope === "total-path"
).length;

console.log(
  `\n[verify-critical-summary] scenario=${scenario} contracts_failed=${failedContractCount} ` +
    `live_path_only_failures=${liveOnlyFailures} total_path_failures=${totalPathFailures} scenario_failures=${failedScenarioCount}`
);

if (failedContractCount > 0 || failedScenarioCount > 0) process.exitCode = 1;

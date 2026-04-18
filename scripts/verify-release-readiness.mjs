import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { ReleaseDecision } from "./release-verification-common.mjs";
import { withSmokeAuthEnv } from "./smoke-auth.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const name of [".env.production.local", ".env.local", ".env.production", ".env"]) {
  loadDotenv({ path: resolve(repoRoot, name), quiet: true });
}

function sanitizeDbEnvValue(raw) {
  if (raw == null) return "";
  let s = String(raw).trim();
  s = s.replace(/\\n$/g, "").replace(/\\r$/g, "").trim();
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return s;
}

function prismaRuntimeEnvKeyForLog() {
  const p = sanitizeDbEnvValue(process.env.POSTGRES_PRISMA_URL);
  if (p) {
    try {
      const u = new URL(p);
      const proto = u.protocol.toLowerCase();
      if (proto === "postgresql:" || proto === "postgres:" || proto === "prisma:") {
        return "POSTGRES_PRISMA_URL";
      }
    } catch {
      // fall through
    }
  }
  if (sanitizeDbEnvValue(process.env.DATABASE_URL)) return "DATABASE_URL";
  return "none";
}

console.log(
  `[release-readiness-env] dotenv_chain=.env.production.local>.env.local>.env.production>.env ` +
    `prisma_runtime_env_key=${prismaRuntimeEnvKeyForLog()}`
);

const previewUrl = String(process.env.RELEASE_PREVIEW_URL || "").trim();
const productionUrl = String(process.env.RELEASE_PRODUCTION_URL || "").trim();
const requirePreview = process.env.RELEASE_REQUIRE_PREVIEW !== "0";
const requireProduction = process.env.RELEASE_REQUIRE_PRODUCTION !== "0";
const targetOnly = process.env.RELEASE_TARGET_ONLY === "1";

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
function run(command, args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env, shell: false });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stderr.write(text);
    });
    child.on("exit", (code) => resolve({ code: code ?? 1, output }));
    child.on("error", (error) => resolve({ code: 1, output: `${output}\n${error.message}` }));
  });
}

const steps = targetOnly
  ? []
  : [
      {
        id: "typecheck",
        command: "pnpm",
        args: ["exec", "tsc", "--noEmit"],
        env: withSmokeAuthEnv(process.env),
        channel: "local",
        required: true,
      },
      {
        id: "unit",
        command: "pnpm",
        args: ["run", "test:unit"],
        env: withSmokeAuthEnv(process.env),
        channel: "local",
        required: true,
      },
      {
        id: "prodlike_ui",
        command: "pnpm",
        args: ["run", "smoke:ui:prodlike"],
        env: withSmokeAuthEnv(process.env),
        channel: "local",
        required: true,
      },
    ];

if (previewUrl) {
  steps.push({
    id: "preview_data",
    command: "pnpm",
    args: ["run", "smoke:data"],
    env: withSmokeAuthEnv({ ...process.env, SMOKE_BASE_URL: previewUrl }),
    channel: "preview",
    required: false,
  });
  steps.push({
    id: "preview_routes",
    command: "pnpm",
    args: ["run", "smoke:routes"],
    env: withSmokeAuthEnv({ ...process.env, SMOKE_BASE_URL: previewUrl }),
    channel: "preview",
    required: false,
  });
  steps.push({
    id: "preview_routes_latency",
    command: "pnpm",
    args: ["run", "smoke:routes:latency"],
    env: withSmokeAuthEnv({ ...process.env, SMOKE_BASE_URL: previewUrl }),
    channel: "preview",
    required: false,
  });
  steps.push({
    id: "preview_ui",
    command: "pnpm",
    args: ["run", "smoke:ui:preview"],
    env: withSmokeAuthEnv({ ...process.env, SMOKE_BASE_URL: previewUrl }),
    channel: "preview",
    required: false,
  });
}

if (productionUrl) {
  steps.push({
    id: "production_safe_data",
    command: "pnpm",
    args: ["run", "smoke:data"],
    env: withSmokeAuthEnv({ ...process.env, SMOKE_BASE_URL: productionUrl }),
    channel: "production",
    required: true,
  });
  steps.push({
    id: "production_safe_routes",
    command: "pnpm",
    args: ["run", "smoke:routes"],
    env: withSmokeAuthEnv({ ...process.env, SMOKE_BASE_URL: productionUrl }),
    channel: "production",
    required: true,
  });
  steps.push({
    id: "production_routes_latency",
    command: "pnpm",
    args: ["run", "smoke:routes:latency"],
    env: withSmokeAuthEnv({ ...process.env, SMOKE_BASE_URL: productionUrl }),
    channel: "production",
    required: false,
  });
}

const failures = [];
const advisories = [];
const sectionSummary = {
  dbConnectionHealth: "unknown",
  freshnessContractHealth: "unknown",
  routeRuntimeCorrectness: "unknown",
  latencyPerfAdvisory: "unknown",
};

for (const step of steps) {
  console.log(`\n[release-readiness] running step=${step.id}`);
  const result = await run(step.command, step.args, step.env || process.env);
  if (result.code !== 0) {
    const authBlocked = result.code === 2 || result.output.includes("classification=PREVIEW_AUTH_BLOCKER");
    if (step.channel === "preview" && authBlocked) {
      advisories.push({
        step: step.id,
        reason: "preview_auth_or_protection_blocked",
        code: result.code,
      });
      continue;
    }
    if (step.channel === "preview" && !step.required) {
      advisories.push({
        step: step.id,
        reason: authBlocked ? "preview_auth_or_protection_blocked" : "preview_verification_failed_non_blocking",
        code: result.code,
      });
      continue;
    }
    failures.push({
      step: step.id,
      decision: authBlocked ? ReleaseDecision.RELEASE_BLOCKED : ReleaseDecision.NO_GO,
      reason: authBlocked ? "target_auth_or_protection_blocked" : "verification_failed",
      code: result.code,
    });
  }
}

function markSectionState(section, next) {
  const priority = { unknown: 0, ok: 1, advisory: 2, failed: 3 };
  if (priority[next] > priority[sectionSummary[section]]) {
    sectionSummary[section] = next;
  }
}

for (const failure of failures) {
  if (failure.step.includes("data")) {
    markSectionState("freshnessContractHealth", "failed");
    markSectionState("dbConnectionHealth", "failed");
  }
  if (failure.step.includes("routes") || failure.step.includes("ui")) {
    markSectionState("routeRuntimeCorrectness", "failed");
  }
}
for (const advisory of advisories) {
  if (advisory.step.includes("latency")) {
    markSectionState("latencyPerfAdvisory", "advisory");
  }
  if (advisory.step.includes("data")) {
    markSectionState("freshnessContractHealth", "advisory");
  }
}
if (sectionSummary.dbConnectionHealth === "unknown") {
  markSectionState("dbConnectionHealth", failures.length > 0 ? "failed" : "ok");
}
if (sectionSummary.freshnessContractHealth === "unknown") {
  markSectionState("freshnessContractHealth", failures.length > 0 ? "failed" : "ok");
}
if (sectionSummary.routeRuntimeCorrectness === "unknown") {
  markSectionState("routeRuntimeCorrectness", failures.some((x) => x.step.includes("routes") || x.step.includes("ui")) ? "failed" : "ok");
}
if (sectionSummary.latencyPerfAdvisory === "unknown") {
  markSectionState("latencyPerfAdvisory", "ok");
}

if (requirePreview && !previewUrl) {
  advisories.push({
    step: "preview_ui",
    reason: "preview_url_missing_informational",
    code: -1,
  });
}
if (previewUrl && !isValidHttpUrl(previewUrl)) {
  failures.push({
    step: "preview_url_validation",
    decision: ReleaseDecision.NO_GO,
    reason: "preview_url_invalid",
    code: -1,
  });
}

if (requireProduction && !productionUrl) {
  failures.push({
    step: "production_safe_routes",
    decision: ReleaseDecision.NO_GO,
    reason: "insufficient_evidence_missing_production_url",
    code: -1,
  });
}
if (productionUrl && !isValidHttpUrl(productionUrl)) {
  failures.push({
    step: "production_url_validation",
    decision: ReleaseDecision.NO_GO,
    reason: "production_url_invalid",
    code: -1,
  });
}

const hasBlocked = failures.some((item) => item.decision === ReleaseDecision.RELEASE_BLOCKED);
const hasNoGo = failures.some((item) => item.decision === ReleaseDecision.NO_GO);
const finalDecision = hasBlocked ? ReleaseDecision.RELEASE_BLOCKED : hasNoGo ? ReleaseDecision.NO_GO : ReleaseDecision.GO;

console.log("\n=== Release Readiness Report ===");
console.log(
  `[release-readiness] mode=${targetOnly ? "target_only" : "full"} ` +
    `has_preview_target=${previewUrl ? 1 : 0} has_production_target=${productionUrl ? 1 : 0}`
);
for (const failure of failures) {
  console.log(
    `[release-readiness] step=${failure.step} decision=${failure.decision} reason=${failure.reason} exit_code=${failure.code}`
  );
}
for (const advisory of advisories) {
  console.log(
    `[release-readiness] step=${advisory.step} advisory=1 reason=${advisory.reason} exit_code=${advisory.code}`
  );
}
console.log(`[release-readiness] final_decision=${finalDecision}`);
console.log(
  `[release-readiness:sections] db_connection_health=${sectionSummary.dbConnectionHealth} ` +
    `freshness_contract_health=${sectionSummary.freshnessContractHealth} ` +
    `route_runtime_correctness=${sectionSummary.routeRuntimeCorrectness} ` +
    `latency_perf_advisory=${sectionSummary.latencyPerfAdvisory}`
);

if (finalDecision === ReleaseDecision.RELEASE_BLOCKED) {
  process.exitCode = 2;
} else if (finalDecision === ReleaseDecision.NO_GO) {
  process.exitCode = 1;
}

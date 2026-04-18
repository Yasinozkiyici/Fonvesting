import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { ReleaseDecision } from "./release-verification-common.mjs";

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

const steps = [
  { id: "typecheck", command: "pnpm", args: ["exec", "tsc", "--noEmit"] },
  { id: "unit", command: "pnpm", args: ["run", "test:unit"] },
  { id: "prodlike_ui", command: "pnpm", args: ["run", "smoke:ui:prodlike"] },
];

if (previewUrl) {
  steps.push({
    id: "preview_data",
    command: "pnpm",
    args: ["run", "smoke:data"],
    env: { ...process.env, SMOKE_BASE_URL: previewUrl },
  });
  steps.push({
    id: "preview_routes",
    command: "pnpm",
    args: ["run", "smoke:routes"],
    env: { ...process.env, SMOKE_BASE_URL: previewUrl },
  });
  steps.push({
    id: "preview_ui",
    command: "pnpm",
    args: ["run", "smoke:ui:preview"],
    env: { ...process.env, SMOKE_BASE_URL: previewUrl },
  });
}

if (productionUrl) {
  steps.push({
    id: "production_data",
    command: "pnpm",
    args: ["run", "smoke:data"],
    env: { ...process.env, SMOKE_BASE_URL: productionUrl },
  });
  steps.push({
    id: "production_routes",
    command: "pnpm",
    args: ["run", "smoke:routes"],
    env: { ...process.env, SMOKE_BASE_URL: productionUrl },
  });
  steps.push({
    id: "production_ui",
    command: "pnpm",
    args: ["run", "smoke:ui:preview"],
    env: { ...process.env, SMOKE_BASE_URL: productionUrl },
  });
}

const failures = [];

for (const step of steps) {
  console.log(`\n[release-readiness] running step=${step.id}`);
  const result = await run(step.command, step.args, step.env || process.env);
  if (result.code !== 0) {
    const authBlocked = result.code === 2 || result.output.includes("classification=PREVIEW_AUTH_BLOCKER");
    failures.push({
      step: step.id,
      decision: authBlocked ? ReleaseDecision.RELEASE_BLOCKED : ReleaseDecision.NO_GO,
      reason: authBlocked ? "preview_or_target_auth_blocked" : "verification_failed",
      code: result.code,
    });
  }
}

if (requirePreview && !previewUrl) {
  failures.push({
    step: "preview_ui",
    decision: ReleaseDecision.NO_GO,
    reason: "insufficient_evidence_missing_preview_url",
    code: -1,
  });
}

if (requireProduction && !productionUrl) {
  failures.push({
    step: "production_ui",
    decision: ReleaseDecision.NO_GO,
    reason: "insufficient_evidence_missing_production_url",
    code: -1,
  });
}

const hasBlocked = failures.some((item) => item.decision === ReleaseDecision.RELEASE_BLOCKED);
const hasNoGo = failures.some((item) => item.decision === ReleaseDecision.NO_GO);
const finalDecision = hasBlocked ? ReleaseDecision.RELEASE_BLOCKED : hasNoGo ? ReleaseDecision.NO_GO : ReleaseDecision.GO;

console.log("\n=== Release Readiness Report ===");
for (const failure of failures) {
  console.log(
    `[release-readiness] step=${failure.step} decision=${failure.decision} reason=${failure.reason} exit_code=${failure.code}`
  );
}
console.log(`[release-readiness] final_decision=${finalDecision}`);

if (finalDecision === ReleaseDecision.RELEASE_BLOCKED) {
  process.exitCode = 2;
} else if (finalDecision === ReleaseDecision.NO_GO) {
  process.exitCode = 1;
}

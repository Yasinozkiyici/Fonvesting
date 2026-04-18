import { spawn } from "node:child_process";
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const name of [".env.production.local", ".env.local", ".env.production", ".env"]) {
  loadDotenv({ path: resolve(repoRoot, name), quiet: true });
}

const port = Number(process.env.SMOKE_PORT || 3100);
const host = process.env.SMOKE_HOST || "127.0.0.1";
const timeoutMs = Number(process.env.SMOKE_START_TIMEOUT_MS || 60_000);
const baseUrl = `http://${host}:${port}`;
/** Compare/detail SSR under DB load can exceed 25s; prodlike must reflect real deploy stability. */
const routeProbeTimeoutMs = Number(process.env.SMOKE_ROUTE_PROBE_TIMEOUT_MS || 60_000);
const routeProbePaths = ["/", "/fund/VGA", "/compare", "/api/funds/compare?codes=VGA,TI1"];

const moduleErrorPattern = /Cannot find module ['"]([^'"]+)['"]/i;
const vendorChunkPattern = /vendor-chunks\//i;

function runCommand(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
      shell: false,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
    });
    child.on("error", reject);
  });
}

function runCommandCapture(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      shell: false,
    });
    let combined = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      combined += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      combined += text;
      process.stderr.write(text);
    });
    child.on("exit", (code) => {
      if (code === 0) resolve({ output: combined });
      else reject(new Error(`${command} ${args.join(" ")} failed with code ${code}\n${combined}`));
    });
    child.on("error", reject);
  });
}

function runBestEffortShell(command, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], {
      stdio: "inherit",
      env,
      shell: false,
    });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

function waitForServer(startedAt = Date.now()) {
  return fetch(baseUrl, { redirect: "manual" })
    .then((response) => {
      if (response.status < 500) return;
      throw new Error(`Server returned ${response.status}`);
    })
    .catch(async () => {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`next start not ready at ${baseUrl} within ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return waitForServer(startedAt);
    });
}

function extractModuleFailure(output) {
  const match = output.match(moduleErrorPattern);
  if (!match) return null;
  return {
    module: match[1] ?? "unknown",
    vendorChunkRelated: vendorChunkPattern.test(match[1] ?? "") || vendorChunkPattern.test(output),
  };
}

async function probeCriticalRoutes(startProc) {
  const errors = [];
  for (const path of routeProbePaths) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        signal: AbortSignal.timeout(routeProbeTimeoutMs),
        redirect: "manual",
      });
    } catch (error) {
      errors.push({
        route: path,
        phase: "runtime_page_generation",
        kind: "fetch_failed",
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const body = await response.text();
    const moduleFailure = extractModuleFailure(body);
    if (response.status >= 500 || moduleFailure) {
      const runtimeOutput = startProc?.combinedOutput ?? "";
      const runtimeModuleFailure = extractModuleFailure(runtimeOutput);
      const failure = moduleFailure ?? runtimeModuleFailure;
      errors.push({
        route: path,
        phase: "runtime_page_generation",
        kind: response.status >= 500 ? "http_5xx" : "module_resolution",
        status: response.status,
        module: failure?.module ?? null,
        vendorChunkRelated: failure?.vendorChunkRelated ?? false,
      });
    }
  }
  return errors;
}

function mergeNodeOptionsForProdlikeIpv4First(existing) {
  const disabled = String(process.env.PRODLIKE_SUPABASE_IPV4_FIRST ?? "").trim() === "0";
  if (disabled) return existing;
  const flag = "--dns-result-order=ipv4first";
  const cur = String(existing ?? "").trim();
  if (cur.includes("dns-result-order")) return existing;
  return cur ? `${cur} ${flag}` : flag;
}

const startEnv = {
  ...process.env,
  HOSTNAME: host,
  PORT: String(port),
  /** Prodlike `next start` ile aynı .env zinciri; Prisma tanıları ve Playwright smoke için üst süreç env’i. */
  PRODLIKE_VERIFICATION: "1",
  NODE_OPTIONS: mergeNodeOptionsForProdlikeIpv4First(process.env.NODE_OPTIONS),
};

let startProc = null;
try {
  await runBestEffortShell(`lsof -ti tcp:${port} | xargs kill -15 2>/dev/null || true`);
  const build = await runCommandCapture("pnpm", ["run", "build:clean"]);
  const buildModuleFailure = extractModuleFailure(build.output);
  if (buildModuleFailure) {
    throw new Error(
      JSON.stringify({
        phase: "build_time",
        kind: "module_resolution",
        module: buildModuleFailure.module,
        vendorChunkRelated: buildModuleFailure.vendorChunkRelated,
      })
    );
  }
  startProc = spawn("pnpm", ["start"], { stdio: ["ignore", "pipe", "pipe"], env: startEnv, shell: false });
  startProc.combinedOutput = "";
  startProc.stdout.on("data", (chunk) => {
    const text = String(chunk);
    startProc.combinedOutput += text;
    process.stdout.write(text);
  });
  startProc.stderr.on("data", (chunk) => {
    const text = String(chunk);
    startProc.combinedOutput += text;
    process.stderr.write(text);
  });
  await waitForServer();
  const routeProbeFailures = await probeCriticalRoutes(startProc);
  if (routeProbeFailures.length > 0) {
    throw new Error(JSON.stringify({ phase: "runtime_page_generation", failures: routeProbeFailures }));
  }
  await runCommand("pnpm", ["run", "smoke:ui-functional"], {
    ...process.env,
    SMOKE_BASE_URL: baseUrl,
    PRODLIKE_VERIFICATION: "1",
  });
  console.log(
    '[release-classification] step=prodlike_ui decision=GO classification=NONE code=prodlike_ui_smoke_ok reason="production artifact UI-functional smoke passed"'
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  let evidence = null;
  try {
    evidence = JSON.parse(message);
  } catch {
    evidence = null;
  }
  console.error(
    '[release-classification] step=prodlike_ui decision=NO_GO classification=PRODUCT_BUG code=prodlike_ui_smoke_failed ' +
      `reason=${JSON.stringify(message)}`
  );
  if (evidence) {
    console.error(`[prodlike-build-integrity-evidence] ${JSON.stringify(evidence)}`);
  }
  process.exitCode = 1;
} finally {
  if (startProc) {
    startProc.kill("SIGTERM");
  }
}

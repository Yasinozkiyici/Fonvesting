import { spawn } from "node:child_process";

const port = Number(process.env.SMOKE_PORT || 3100);
const host = process.env.SMOKE_HOST || "127.0.0.1";
const timeoutMs = Number(process.env.SMOKE_START_TIMEOUT_MS || 60_000);
const baseUrl = `http://${host}:${port}`;

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

const startEnv = {
  ...process.env,
  HOSTNAME: host,
  PORT: String(port),
};

let startProc = null;
try {
  await runBestEffortShell(`lsof -ti tcp:${port} | xargs kill -15 2>/dev/null || true`);
  await runCommand("pnpm", ["run", "build:clean"]);
  startProc = spawn("pnpm", ["start"], { stdio: "inherit", env: startEnv, shell: false });
  await waitForServer();
  await runCommand("pnpm", ["run", "smoke:ui-functional"], {
    ...process.env,
    SMOKE_BASE_URL: baseUrl,
  });
  console.log(
    '[release-classification] step=prodlike_ui decision=GO classification=NONE code=prodlike_ui_smoke_ok reason="production artifact UI-functional smoke passed"'
  );
} catch (error) {
  console.error(
    '[release-classification] step=prodlike_ui decision=NO_GO classification=PRODUCT_BUG code=prodlike_ui_smoke_failed ' +
      `reason=${JSON.stringify(error instanceof Error ? error.message : String(error))}`
  );
  process.exitCode = 1;
} finally {
  if (startProc) {
    startProc.kill("SIGTERM");
  }
}

import { execSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const nextBinHint = path.join(projectRoot, "node_modules");

function listRunningNextDevPids() {
  const output = execSync("ps -axo pid=,command=", { encoding: "utf8" });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) return null;
      return { pid: Number(match[1]), command: match[2] };
    })
    .filter((entry) => {
      if (!entry) return false;
      if (entry.pid === process.pid) return false;
      return entry.command.includes("next dev") && entry.command.includes(nextBinHint);
    });
}

function stopRunningNextDev() {
  const entries = listRunningNextDevPids();
  for (const entry of entries) {
    try {
      process.kill(entry.pid, "SIGTERM");
    } catch {
      // Process already exited.
    }
  }

  if (entries.length > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
  }
}

stopRunningNextDev();
rmSync(path.join(projectRoot, ".next"), { recursive: true, force: true });

const child = spawn("pnpm", ["dev"], {
  cwd: projectRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

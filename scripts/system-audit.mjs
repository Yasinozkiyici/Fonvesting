const baseUrl = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 20000);

const checks = [
  { kind: "api", path: "/api/health", maxMs: 7000 },
  { kind: "api", path: "/api/market", maxMs: 3000 },
  { kind: "api", path: "/api/funds/scores?mode=BEST", maxMs: 4000 },
  { kind: "api", path: "/api/funds?page=1&pageSize=5", maxMs: 5000 },
  { kind: "page", path: "/", maxMs: 5000, mustInclude: ["Yatirim.io", "Fonlar"] },
  { kind: "page", path: "/fund/VGA", maxMs: 6000, mustInclude: ["Fon detayı", "Son fiyat"] },
  // Edge case: invalid mode should degrade gracefully (not 5xx).
  { kind: "api", path: "/api/funds/scores?mode=INVALID_MODE", maxMs: 5000, allow4xx: true },
];

async function runCheck(check) {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}${check.path}`, { signal: AbortSignal.timeout(timeoutMs) });
  const durationMs = Date.now() - startedAt;
  const body = await response.text();
  return { response, body, durationMs };
}

let failed = false;
let warning = false;

for (const check of checks) {
  try {
    const { response, body, durationMs } = await runCheck(check);
    const isAcceptedStatus = response.ok || (check.allow4xx && response.status >= 400 && response.status < 500);
    if (!isAcceptedStatus) {
      console.error(`[audit] ${check.path} failed: HTTP ${response.status}`);
      failed = true;
      continue;
    }
    if (check.mustInclude) {
      for (const token of check.mustInclude) {
        if (!body.includes(token)) {
          console.error(`[audit] ${check.path} missing token: ${token}`);
          failed = true;
        }
      }
    }
    if (durationMs > check.maxMs) {
      console.warn(`[audit] ${check.path} slow: ${durationMs}ms (target <= ${check.maxMs}ms)`);
      warning = true;
    } else {
      console.log(`[audit] ${check.path} ok in ${durationMs}ms`);
    }
  } catch (error) {
    console.error(`[audit] ${check.path} failed: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
} else if (warning) {
  console.log("[audit] completed with latency warnings");
} else {
  console.log("[audit] all checks passed");
}

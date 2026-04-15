const baseUrl = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 30000);
const retryCount = Number(process.env.AUDIT_RETRY_COUNT || 2);
const retryDelayMs = Number(process.env.AUDIT_RETRY_DELAY_MS || 900);

const checks = [
  { kind: "api", name: "health_light", path: "/api/health?mode=light", maxMs: 7000, retry: retryCount },
  { kind: "api", path: "/api/market", maxMs: 3000, retry: 1 },
  { kind: "api", path: "/api/funds/scores?mode=BEST&limit=150", maxMs: 4000, retry: 1 },
  { kind: "api", path: "/api/funds?page=1&pageSize=5", maxMs: 5000, retry: 1 },
  { kind: "api", path: "/api/funds/compare?codes=VGA,TI1", maxMs: 5000, retry: 1 },
  { kind: "api", path: "/api/funds/compare-series?base=VGA&codes=", maxMs: 5000, retry: 1 },
  { kind: "api", path: "/api/funds/compare-series?base=VGA&codes=TI1", maxMs: 5000, retry: 1 },
  {
    kind: "api",
    path: "/api/funds/compare-series?base=INVALID&codes=TI1",
    maxMs: 5000,
    allow4xx: true,
    retry: 1,
  },
  { kind: "page", path: "/", maxMs: 5000, mustInclude: ["Yatirim.io", "Fonlar"], retry: 1 },
  { kind: "page", path: "/compare", maxMs: 5000, mustInclude: ["Karşılaştır"], retry: 1 },
  { kind: "page", path: "/fund/VGA", maxMs: 6000, mustInclude: ["Fon detayı", "Son fiyat"], retry: 1 },
  { kind: "page", path: "/fund/TI1", maxMs: 6000, mustInclude: ["Fon detayı", "Son fiyat"], retry: 1 },
  { kind: "page", path: "/fund/ZP8", maxMs: 6000, mustInclude: ["Fon detayı", "Son fiyat"], retry: 1 },
  // Edge case: invalid mode should degrade gracefully (not 5xx).
  { kind: "api", path: "/api/funds/scores?mode=INVALID_MODE&limit=150", maxMs: 5000, allow4xx: true, retry: 1 },
];

async function runCheck(check) {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}${check.path}`, { signal: AbortSignal.timeout(timeoutMs) });
  const durationMs = Date.now() - startedAt;
  const body = await response.text();
  return { response, body, durationMs };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyFailure(errorOrStatus, route) {
  const raw = typeof errorOrStatus === "string" ? errorOrStatus : "";
  const lower = raw.toLowerCase();
  if (lower.includes("timeout") || lower.includes("aborted")) return "timeout";
  if (lower.includes("p2024")) return "pool_checkout_timeout";
  if (lower.includes("p1017") || lower.includes("connection")) return "connection_closed";
  if (lower.includes("p2028") || lower.includes("transaction")) return "transaction_timeout";
  if (lower.includes("503")) return "http_503";
  if (route.includes("/api/funds/scores")) return "scores_route_failure";
  if (route.includes("/api/health")) return "health_route_failure";
  return "unknown";
}

function isDbRelatedRoute(route) {
  return (
    route.includes("/api/health") ||
    route.includes("/api/funds") ||
    route.includes("/api/market") ||
    route.includes("/fund/")
  );
}

let failed = false;
let warning = false;

for (const check of checks) {
  const stepName = check.name || check.path.replace(/[/?=&]/g, "_");
  const maxAttempts = Number.isFinite(check.retry) ? check.retry + 1 : 1;
  let stepPassed = false;
  let attempt = 0;
  let lastFailure = "";
  let recoveredOnRetry = false;

  while (attempt < maxAttempts && !stepPassed) {
    attempt += 1;
    try {
      const { response, body, durationMs } = await runCheck(check);
      const isAcceptedStatus = response.ok || (check.allow4xx && response.status >= 400 && response.status < 500);
      const healthMode = response.headers.get("x-health-mode") || "none";
      const healthDbProbe = response.headers.get("x-health-db-probe-used") || "none";
      const systemCheckDegraded = response.headers.get("x-system-check-degraded") || "0";
      const systemCheckReason = response.headers.get("x-system-check-reason") || "none";
      const marketFailureClass = response.headers.get("x-market-failure-class") || "none";
      const marketFallbackUsed = response.headers.get("x-market-fallback-used") || "0";
      const healthStepDurationMs = stepName === "health_light" ? durationMs : -1;
      console.log(
        `[audit-step] audit_step_name=${stepName} audit_step_duration_ms=${durationMs} route=${check.path} ` +
          `status=${response.status} health_mode=${healthMode} health_db_probe_used=${healthDbProbe} ` +
          `system_check_degraded=${systemCheckDegraded} system_check_reason=${systemCheckReason} ` +
          `market_failure_class=${marketFailureClass} market_fallback_used=${marketFallbackUsed} ` +
          `health_step_duration_ms=${healthStepDurationMs} attempt=${attempt}`
      );

      if (!isAcceptedStatus) {
        lastFailure = `HTTP ${response.status}`;
        throw new Error(lastFailure);
      }
      if (check.mustInclude) {
        for (const token of check.mustInclude) {
          if (!body.includes(token)) {
            lastFailure = `missing token: ${token}`;
            throw new Error(lastFailure);
          }
        }
      }
      if (durationMs > check.maxMs) {
        console.warn(`[audit] ${check.path} slow: ${durationMs}ms (target <= ${check.maxMs}ms)`);
        warning = true;
      } else {
        console.log(`[audit] ${check.path} ok in ${durationMs}ms`);
      }
      if (attempt > 1) recoveredOnRetry = true;
      stepPassed = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastFailure = message;
      const failureClass = classifyFailure(message, check.path);
      console.warn(
        `[audit-step-fail] audit_step_name=${stepName} audit_failure_route=${check.path} ` +
          `audit_failure_class=${failureClass} audit_db_related=${isDbRelatedRoute(check.path) ? 1 : 0} ` +
          `attempt=${attempt}/${maxAttempts} message=${message}`
      );
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs);
      }
    }
  }

  if (!stepPassed) {
    console.error(
      `[audit] ${check.path} failed after ${maxAttempts} attempts: ${lastFailure || "unknown"}`
    );
    failed = true;
    continue;
  }

  if (recoveredOnRetry) {
    warning = true;
    console.warn(
      `[audit] ${check.path} recovered_after_retry attempts=${attempt} route=${check.path}`
    );
  }
}

if (failed) {
  process.exitCode = 1;
} else if (warning) {
  console.log("[audit] completed with latency warnings");
} else {
  console.log("[audit] all checks passed");
}

const baseUrl = (process.env.SMOKE_BASE_URL || "https://www.yatirim.io").replace(/\/+$/, "");
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
const compareMaxMs = Number(process.env.SMOKE_COMPARE_MAX_MS || 5000);
const pageMaxMs = Number(process.env.SMOKE_PAGE_MAX_MS || 6000);
const scoresMaxMs = Number(process.env.SMOKE_SCORES_MAX_MS || 4500);

const checks = [
  {
    name: "homepage",
    path: "/",
    type: "text",
    maxMs: pageMaxMs,
    validateText(body) {
      return body.includes("Yatirim.io") && body.includes("Fonlar") && body.includes("/_next/static/");
    },
  },
  {
    name: "fund-vga",
    path: "/fund/VGA",
    type: "text",
    maxMs: pageMaxMs,
    validateText(body) {
      return body.includes("Fon detayı") && body.includes("Son fiyat");
    },
  },
  {
    name: "fund-ti1",
    path: "/fund/TI1",
    type: "text",
    maxMs: pageMaxMs,
    validateText(body) {
      return body.includes("Fon detayı") && body.includes("Son fiyat");
    },
  },
  {
    name: "fund-zp8",
    path: "/fund/ZP8",
    type: "text",
    maxMs: pageMaxMs,
    validateText(body) {
      return body.includes("Fon detayı") && body.includes("Son fiyat");
    },
  },
  {
    name: "compare-page",
    path: "/compare",
    type: "text",
    maxMs: pageMaxMs,
    validateText(body) {
      return body.includes("Karşılaştır") && body.includes("/_next/static/");
    },
  },
  {
    name: "health-light",
    path: "/api/health?mode=light",
    validate(payload, response) {
      return (
        payload?.ok === true &&
        (payload.userCriticalReadiness === true ||
          payload.userCriticalReadiness?.operational === true ||
          payload.database?.diagnostics?.readPathOperational === true) &&
        response.headers.get("x-db-failure-class") === "none"
      );
    },
  },
  {
    name: "market",
    path: "/api/market",
    validate(payload) {
      return typeof payload?.fundCount === "number";
    },
  },
  {
    name: "scores",
    path: "/api/funds/scores?mode=BEST",
    maxMs: scoresMaxMs,
    validate(payload) {
      return Array.isArray(payload?.funds) && payload.funds.length > 0;
    },
  },
  {
    name: "funds",
    path: "/api/funds?limit=5",
    validate(payload) {
      return Array.isArray(payload?.items) && payload.items.length > 0;
    },
  },
  {
    name: "compare",
    path: "/api/funds/compare?codes=VGA,TI1",
    maxMs: compareMaxMs,
    allowedFailureClasses: new Set(["context_optional_skipped"]),
    validate(payload) {
      return Array.isArray(payload?.funds) && payload.funds.length >= 2;
    },
  },
  {
    name: "compare-series-base",
    path: "/api/funds/compare-series?base=VGA&codes=",
    allowedFailureClasses: new Set(["optional_timeout", "optional_failed"]),
    validate(payload) {
      return (
        Array.isArray(payload?.fundSeries) &&
        payload.fundSeries.some((item) => item?.code === "VGA" && Array.isArray(item.series) && item.series.length > 0)
      );
    },
  },
  {
    name: "compare-series-pair",
    path: "/api/funds/compare-series?base=VGA&codes=TI1",
    allowedFailureClasses: new Set(["optional_timeout", "optional_failed"]),
    validate(payload) {
      return (
        Array.isArray(payload?.fundSeries) &&
        ["VGA", "TI1"].every((code) =>
          payload.fundSeries.some((item) => item?.code === code && Array.isArray(item.series) && item.series.length > 0)
        )
      );
    },
  },
  {
    name: "compare-series-invalid",
    path: "/api/funds/compare-series?base=INVALID&codes=TI1",
    expectedStatus: 404,
    validate(payload) {
      return payload?.error === "base_not_found";
    },
  },
];

function shortBody(raw) {
  if (!raw) return "";
  return raw.length > 220 ? `${raw.slice(0, 220)}...` : raw;
}

function failSummary(name, status, headers, body) {
  return `[smoke:prod-db] ${name} FAIL status=${status} x-db-env-status=${headers.get("x-db-env-status") ?? "n/a"} x-db-connection-mode=${
    headers.get("x-db-connection-mode") ?? "n/a"
  } x-db-failure-class=${headers.get("x-db-failure-class") ?? "n/a"} body=${shortBody(body)}`;
}

let failed = false;

for (const check of checks) {
  const url = `${baseUrl}${check.path}`;
  let response;
  let body;
  let durationMs = 0;
  try {
    const startedAt = Date.now();
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    durationMs = Date.now() - startedAt;
    body = await response.text();
  } catch (error) {
    console.error(`[smoke:prod-db] ${check.name} ERROR ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
    continue;
  }

  const headers = response.headers;
  const dbFailure = headers.get("x-db-failure-class");
  const compareFailure = headers.get("x-compare-failure-class");
  const compareSeriesFailure = headers.get("x-compare-series-failure-class");
  const dbEnvStatus = headers.get("x-db-env-status");
  const scoreDegraded = headers.get("x-scores-degraded");
  const marketDegraded = headers.get("x-market-degraded");
  const fundsDegraded = headers.get("x-funds-degraded");
  let payload = null;
  if (check.type !== "text") {
    try {
      payload = body ? JSON.parse(body) : null;
    } catch {
      // handled by validate below
    }
  }
  const expectedStatus = check.expectedStatus ?? 200;
  const failureClasses = [dbFailure, compareFailure, compareSeriesFailure].filter(Boolean);
  const allowedFailureClasses = check.allowedFailureClasses ?? new Set();
  const hasUnexpectedFailureClass = failureClasses.some((failureClass) => {
    if (failureClass === "none") return false;
    return !String(failureClass)
      .split(",")
      .every((item) => allowedFailureClasses.has(item));
  });
  const shapeOk =
    typeof check.validateText === "function"
      ? check.validateText(body, response)
      : typeof check.validate === "function"
        ? check.validate(payload, response)
        : true;
  const latencyOk = !check.maxMs || durationMs <= check.maxMs;

  const unhealthy =
    response.status !== expectedStatus ||
    !shapeOk ||
    !latencyOk ||
    dbEnvStatus === "missing_database_url" ||
    dbEnvStatus === "invalid_database_url" ||
    hasUnexpectedFailureClass ||
    Boolean(scoreDegraded || marketDegraded || fundsDegraded);

  if (unhealthy) {
    console.error(failSummary(check.name, response.status, headers, body));
    failed = true;
    continue;
  }

  console.log(
    `[smoke:prod-db] ${check.name} OK status=${response.status} x-db-env-status=${dbEnvStatus ?? "ok"} x-db-connection-mode=${
      headers.get("x-db-connection-mode") ?? "n/a"
    } duration_ms=${durationMs}`
  );
}

if (failed) process.exitCode = 1;

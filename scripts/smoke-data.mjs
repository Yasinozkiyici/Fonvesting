const baseUrl = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

function hasHealthyScoresSet(payload) {
  const funds = Array.isArray(payload?.funds) ? payload.funds : [];
  if (funds.length === 0) return false;
  const codes = funds
    .map((item) => String(item?.code || "").trim().toUpperCase())
    .filter(Boolean);
  const uniqueCount = new Set(codes).size;
  if (uniqueCount < Math.min(8, codes.length)) return false;
  const uniqueRatio = uniqueCount / Math.max(codes.length, 1);
  if (uniqueRatio < 0.7) return false;
  return typeof payload?.total === "number" && payload.total >= uniqueCount;
}

const checks = [
  {
    path: "/api/health?mode=light",
    validate(payload, response) {
      return (
        typeof payload === "object" &&
        payload !== null &&
        payload.ok === true &&
        (payload.userCriticalReadiness === true ||
          payload.userCriticalReadiness?.operational === true ||
          payload.database?.diagnostics?.readPathOperational === true) &&
        response.headers.get("x-db-failure-class") === "none"
      );
    },
  },
  {
    path: "/api/funds?page=1&pageSize=5",
    validate(payload) {
      return typeof payload === "object" && payload !== null && Array.isArray(payload.items) && payload.items.length > 0;
    },
  },
  {
    path: "/api/funds/scores?mode=BEST&limit=150",
    maxMs: 5000,
    validate(payload, response) {
      const scoresSource = response.headers.get("x-scores-source") || "none";
      const emptyResult = response.headers.get("x-scores-empty-result");
      if (emptyResult && emptyResult !== "none") return false;
      if (scoresSource === "none") return false;
      return typeof payload === "object" && payload !== null && hasHealthyScoresSet(payload);
    },
  },
  {
    path: "/api/market",
    validate(payload) {
      return typeof payload === "object" && payload !== null && typeof payload.fundCount === "number";
    },
  },
  {
    path: "/api/funds/compare?codes=VGA,TI1",
    maxMs: 5000,
    validate(payload) {
      return typeof payload === "object" && payload !== null && Array.isArray(payload.funds) && payload.funds.length >= 2;
    },
  },
  {
    path: "/api/funds/compare-series?base=VGA&codes=",
    validate(payload) {
      return (
        typeof payload === "object" &&
        payload !== null &&
        Array.isArray(payload.fundSeries) &&
        payload.fundSeries.some((item) => item?.code === "VGA" && Array.isArray(item.series) && item.series.length > 0)
      );
    },
  },
  {
    path: "/api/funds/compare-series?base=VGA&codes=TI1",
    validate(payload) {
      return (
        typeof payload === "object" &&
        payload !== null &&
        Array.isArray(payload.fundSeries) &&
        ["VGA", "TI1"].every((code) =>
          payload.fundSeries.some((item) => item?.code === code && Array.isArray(item.series) && item.series.length > 0)
        )
      );
    },
  },
  {
    path: "/api/funds/compare-series?base=INVALID&codes=TI1",
    expectedStatus: 404,
    validate(payload) {
      return typeof payload === "object" && payload !== null && payload.error === "base_not_found";
    },
  },
];

const FETCH_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30000);
const RETRY_COUNT = Number(process.env.SMOKE_RETRY_COUNT || 1);
const RETRY_DELAY_MS = Number(process.env.SMOKE_RETRY_DELAY_MS || 1200);

let failed = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const check of checks) {
  let passed = false;
  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt += 1) {
    let response;
    let text;
    let durationMs;
    try {
      const startedAt = Date.now();
      response = await fetch(`${baseUrl}${check.path}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      text = await response.text();
      durationMs = Date.now() - startedAt;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < RETRY_COUNT) {
        console.warn(
          `[smoke:data] ${check.path} retrying after error (attempt ${attempt + 1}/${RETRY_COUNT + 1}): ${lastError}`
        );
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      break;
    }

    const expectedStatus = check.expectedStatus ?? 200;
    if (response.status !== expectedStatus) {
      lastError = `HTTP ${response.status}`;
      if (attempt < RETRY_COUNT) {
        console.warn(
          `[smoke:data] ${check.path} retrying after ${lastError} (attempt ${attempt + 1}/${RETRY_COUNT + 1})`
        );
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      break;
    }

    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      lastError = "invalid JSON";
      if (attempt < RETRY_COUNT) {
        console.warn(
          `[smoke:data] ${check.path} retrying after invalid JSON (attempt ${attempt + 1}/${RETRY_COUNT + 1})`
        );
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      break;
    }

    if (!check.validate(json, response)) {
      lastError = "unexpected shape";
      if (attempt < RETRY_COUNT) {
        console.warn(
          `[smoke:data] ${check.path} retrying after unexpected shape (attempt ${attempt + 1}/${RETRY_COUNT + 1})`
        );
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      break;
    }

    if (check.maxMs && durationMs > check.maxMs) {
      lastError = `latency ${durationMs}ms > ${check.maxMs}ms`;
      if (attempt < RETRY_COUNT) {
        console.warn(
          `[smoke:data] ${check.path} retrying after slow response (attempt ${attempt + 1}/${RETRY_COUNT + 1}): ${lastError}`
        );
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      break;
    }

    passed = true;
    console.log(`[smoke:data] ${check.path} ok in ${durationMs}ms${attempt > 0 ? ` (retry=${attempt})` : ""}`);
    break;
  }

  if (!passed) {
    console.error(`[smoke:data] ${check.path} failed: ${lastError || "unknown error"}`);
    failed = true;
  }
}

if (failed) {
  console.log(
    "[release-classification] step=smoke_data decision=NO_GO classification=PRODUCT_BUG code=data_contract_failed " +
      'reason="release-significant data checks failed"'
  );
  process.exitCode = 1;
} else {
  console.log(
    "[release-classification] step=smoke_data decision=GO classification=NONE code=data_contract_ok " +
      'reason="data smoke checks passed with non-polluted payload constraints"'
  );
}

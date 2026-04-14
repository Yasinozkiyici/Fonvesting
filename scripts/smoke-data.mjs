const baseUrl = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

const checks = [
  {
    path: "/api/health?mode=light",
    validate(payload) {
      return typeof payload === "object" && payload !== null && "ok" in payload;
    },
  },
  {
    path: "/api/funds?page=1&pageSize=5",
    validate(payload) {
      return typeof payload === "object" && payload !== null && Array.isArray(payload.items);
    },
  },
  {
    path: "/api/funds/scores?mode=BEST&limit=150",
    validate(payload) {
      return typeof payload === "object" && payload !== null && Array.isArray(payload.funds);
    },
  },
  {
    path: "/api/market",
    validate(payload) {
      return typeof payload === "object" && payload !== null && typeof payload.fundCount === "number";
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

    if (!response.ok) {
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

    if (!check.validate(json)) {
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
  process.exitCode = 1;
}

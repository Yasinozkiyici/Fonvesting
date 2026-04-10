const baseUrl = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

const checks = [
  {
    path: "/api/health",
    validate(payload) {
      return typeof payload === "object" && payload !== null && "ok" in payload;
    },
  },
  {
    path: "/api/funds?page=1&pageSize=5",
    validate(payload) {
      return typeof payload === "object" && payload !== null && Array.isArray(payload.items) && payload.items.length > 0;
    },
  },
  {
    path: "/api/funds/scores?mode=BEST",
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

const FETCH_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

let failed = false;

for (const check of checks) {
  let response;
  let text;
  let durationMs;
  try {
    const startedAt = Date.now();
    response = await fetch(`${baseUrl}${check.path}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    text = await response.text();
    durationMs = Date.now() - startedAt;
  } catch (error) {
    console.error(`[smoke:data] ${check.path} failed: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
    continue;
  }

  if (!response.ok) {
    console.error(`[smoke:data] ${check.path} failed with HTTP ${response.status}`);
    failed = true;
    continue;
  }

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    console.error(`[smoke:data] ${check.path} returned invalid JSON`);
    failed = true;
    continue;
  }

  if (!check.validate(json)) {
    console.error(`[smoke:data] ${check.path} returned unexpected shape`);
    failed = true;
    continue;
  }

  console.log(`[smoke:data] ${check.path} ok in ${durationMs}ms`);
}

if (failed) {
  process.exitCode = 1;
}

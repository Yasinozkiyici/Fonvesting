import { classifySmokeAccessFailure, withSmokeAuthFetchOptions } from "./smoke-auth.mjs";

const baseUrl = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const forbiddenTokens = [
  "chunkloaderror",
  "loading chunk",
  "cannot find module",
  "__next_css__do_not_use__",
];

const routeChecks = [
  { path: "/", mustInclude: ["Yatirim.io", "Fonlar"], maxMs: 6000 },
  { path: "/compare", mustInclude: ["Karşılaştır"], maxMs: 5000 },
  { path: "/fund/VGA", mustInclude: ["Fon detayı", "Son fiyat", "Portföy"], maxMs: 6000 },
  { path: "/fund/TI1", mustInclude: ["Fon detayı", "Son fiyat"], maxMs: 6000 },
  { path: "/fund/ZP8", mustInclude: ["Fon detayı", "Son fiyat"], maxMs: 6000 },
];

const FETCH_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
const ENFORCE_LATENCY = String(process.env.SMOKE_ROUTES_ENFORCE_LATENCY ?? "").trim() === "1";

async function fetchText(path) {
  const startedAt = Date.now();
  const response = await fetch(
    `${baseUrl}${path}`,
    withSmokeAuthFetchOptions({ signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  );
  const body = await response.text();
  return { response, body, durationMs: Date.now() - startedAt };
}

let correctnessFailed = false;
let latencyFailed = false;
let authBlocked = false;
let authFailureCode = null;

for (const check of routeChecks) {
  let response;
  let body;
  let durationMs;
  try {
    ({ response, body, durationMs } = await fetchText(check.path));
  } catch (error) {
    console.error(`[smoke:routes] ${check.path} failed: ${error instanceof Error ? error.message : String(error)}`);
    correctnessFailed = true;
    continue;
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      authBlocked = true;
      authFailureCode = classifySmokeAccessFailure(response.status);
    }
    console.error(`[smoke:routes] ${check.path} failed with HTTP ${response.status}`);
    correctnessFailed = true;
    continue;
  }
  for (const token of check.mustInclude) {
    if (!body.includes(token)) {
      console.error(`[smoke:routes] ${check.path} missing token: ${token}`);
      correctnessFailed = true;
    }
  }
  if (!body.includes("data-surface-state=")) {
    console.error(`[smoke:routes] ${check.path} missing typed surface-state marker`);
    correctnessFailed = true;
  }
  const hasNextShellEvidence =
    body.includes('id="__next"') ||
    body.includes("/_next/static/") ||
    body.includes("self.__next_f");
  if (!hasNextShellEvidence) {
    console.error(`[smoke:routes] ${check.path} missing Next shell evidence`);
    correctnessFailed = true;
  }
  const lowered = body.toLocaleLowerCase("tr-TR");
  for (const token of forbiddenTokens) {
    if (lowered.includes(token)) {
      console.error(`[smoke:routes] ${check.path} includes runtime failure token: ${token}`);
      correctnessFailed = true;
    }
  }
  if (check.maxMs && durationMs > check.maxMs) {
    console.error(`[smoke:routes] ${check.path} exceeded latency budget: ${durationMs}ms > ${check.maxMs}ms`);
    latencyFailed = true;
    if (ENFORCE_LATENCY) continue;
  }
  console.log(`[smoke:routes] ${check.path} ok in ${durationMs}ms`);
}

if (correctnessFailed) {
  if (authBlocked) {
    console.log(
      "[release-classification] step=smoke_routes decision=RELEASE_BLOCKED classification=PREVIEW_AUTH_BLOCKER " +
        `code=${authFailureCode ?? "auth_invalid"} reason="post-deploy smoke route access blocked by protection"`
    );
    process.exitCode = 2;
  } else {
    console.log(
      "[release-classification] step=smoke_routes decision=NO_GO classification=RUNTIME_CLIENT_ASSET_FAILURE " +
        'code=route_runtime_contract_failed reason="route shell/runtime checks failed" details="non-auth application failure"'
    );
    process.exitCode = 1;
  }
} else if (latencyFailed && ENFORCE_LATENCY) {
  console.log(
    "[release-classification] step=smoke_routes_latency decision=NO_GO classification=PERFORMANCE_BUDGET " +
      'code=route_latency_budget_failed reason="route latency budget exceeded"'
  );
  process.exitCode = 1;
} else if (latencyFailed) {
  console.log(
    "[release-classification] step=smoke_routes_latency decision=GO classification=PERFORMANCE_BUDGET " +
      'code=route_latency_budget_warning reason="route latency budget exceeded (non-blocking)"'
  );
} else {
  console.log(
    "[release-classification] step=smoke_routes decision=GO classification=NONE " +
      'code=route_runtime_contract_ok reason="route shell/runtime checks passed"'
  );
}

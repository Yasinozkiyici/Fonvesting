const baseUrl = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

const routeChecks = [
  { path: "/", mustInclude: ["Yatirim.io", "Fonlar"] },
  { path: "/compare", mustInclude: ["Karşılaştır"] },
  { path: "/fund/VGA", mustInclude: ["Fon detayı", "Son fiyat", "Portföy"] },
];

const FETCH_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

async function fetchText(path) {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const body = await response.text();
  return { response, body, durationMs: Date.now() - startedAt };
}

let failed = false;

for (const check of routeChecks) {
  let response;
  let body;
  let durationMs;
  try {
    ({ response, body, durationMs } = await fetchText(check.path));
  } catch (error) {
    console.error(`[smoke:routes] ${check.path} failed: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
    continue;
  }
  if (!response.ok) {
    console.error(`[smoke:routes] ${check.path} failed with HTTP ${response.status}`);
    failed = true;
    continue;
  }
  for (const token of check.mustInclude) {
    if (!body.includes(token)) {
      console.error(`[smoke:routes] ${check.path} missing token: ${token}`);
      failed = true;
    }
  }
  console.log(`[smoke:routes] ${check.path} ok in ${durationMs}ms`);
}

if (failed) {
  process.exitCode = 1;
}

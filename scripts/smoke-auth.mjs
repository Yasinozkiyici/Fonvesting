const BYPASS_HEADER_NAME = "x-vercel-protection-bypass";
const BYPASS_SET_COOKIE_HEADER_NAME = "x-vercel-set-bypass-cookie";
const BYPASS_COOKIE_NAME = "__vercel_protection_bypass";

function readRawSmokeBypassSecret() {
  const direct = String(process.env.SMOKE_BYPASS_TOKEN || "").trim();
  if (direct) return direct;
  const legacy = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "").trim();
  if (legacy) return legacy;
  return "";
}

export function getSmokeBypassSecret() {
  return readRawSmokeBypassSecret();
}

export function hasSmokeBypassSecret() {
  return getSmokeBypassSecret().length > 0;
}

export function buildSmokeAuthHeaders() {
  const secret = getSmokeBypassSecret();
  if (!secret) return {};
  return {
    [BYPASS_HEADER_NAME]: secret,
    [BYPASS_SET_COOKIE_HEADER_NAME]: "true",
    cookie: `${BYPASS_COOKIE_NAME}=${encodeURIComponent(secret)}`,
  };
}

export function withSmokeAuthFetchOptions(options = {}) {
  const headers = {
    ...(options.headers || {}),
    ...buildSmokeAuthHeaders(),
  };
  return {
    ...options,
    headers,
  };
}

export function getPlaywrightSmokeContextOptions() {
  const headers = buildSmokeAuthHeaders();
  if (Object.keys(headers).length === 0) return {};
  return {
    extraHTTPHeaders: headers,
  };
}

export function classifySmokeAccessFailure(status) {
  if (status === 401) {
    return hasSmokeBypassSecret() ? "auth_invalid" : "auth_missing";
  }
  if (status === 403) return "auth_forbidden";
  return "non-auth application failure";
}

export function withSmokeAuthEnv(baseEnv = process.env) {
  const secret = getSmokeBypassSecret();
  if (!secret) return { ...baseEnv };
  return { ...baseEnv, SMOKE_BYPASS_TOKEN: secret };
}

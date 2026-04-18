type StrictRequestLike = {
  headers?: Headers;
  nextUrl?: URL;
  url?: string;
} | null;

function isTrue(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isServingStrictModeEnabled(request: StrictRequestLike): boolean {
  if (isTrue(process.env.SERVING_CUTOVER_STRICT)) return true;
  if (request?.headers && isTrue(request.headers.get("x-serving-strict"))) return true;
  const urlRaw = request?.nextUrl?.toString() ?? request?.url;
  if (urlRaw) {
    try {
      const url = request?.nextUrl ?? new URL(urlRaw);
      if (isTrue(url.searchParams.get("serving_strict"))) return true;
    } catch {
      // ignore malformed URL
    }
  }
  return false;
}

export function servingStrictHeaders(input: {
  enabled: boolean;
  violated: boolean;
  reason?: string | null;
}): Record<string, string> {
  return {
    "X-Serving-Strict-Mode": input.enabled ? "1" : "0",
    "X-Serving-Strict-Violation": input.violated ? "1" : "0",
    "X-Serving-Strict-Reason": input.reason?.trim() ? input.reason : "none",
  };
}

type FetchJsonOptions = {
  revalidate?: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
};

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 1;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function getSupabaseRestConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

export function hasSupabaseRestConfig(): boolean {
  return getSupabaseRestConfig() !== null;
}

export async function fetchSupabaseRestResponse(pathAndQuery: string, options: FetchJsonOptions = {}): Promise<Response> {
  const config = getSupabaseRestConfig();
  if (!config) {
    throw new Error("supabase_rest_not_configured");
  }

  const baseUrl = config.url.replace(/\/+$/, "");
  const path = pathAndQuery.replace(/^\/+/, "");
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1_000, Number(options.timeoutMs)) : DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, Number.isFinite(options.retries) ? Number(options.retries) + 1 : DEFAULT_RETRIES + 1);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(`supabase_rest_timeout_${timeoutMs}ms`), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${config.key}`,
          Accept: "application/json",
          ...(options.headers ?? {}),
        },
        next: {
          revalidate: options.revalidate ?? 300,
        },
        signal: controller.signal,
      });

      if (response.ok) {
        return response;
      }

      const body = await response.text();
      const error = new Error(`supabase_rest_failed:${response.status}:${body.slice(0, 200)}`);
      if (attempt >= maxAttempts || !RETRYABLE_STATUSES.has(response.status)) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = message.includes("timeout") || message.includes("abort") || message.includes("fetch failed");
      if (attempt >= maxAttempts || !retryable) {
        throw (error instanceof Error ? error : new Error(String(error)));
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("supabase_rest_failed");
}

export async function fetchSupabaseRestJson<T>(pathAndQuery: string, options: FetchJsonOptions = {}): Promise<T> {
  const response = await fetchSupabaseRestResponse(pathAndQuery, options);
  return response.json() as Promise<T>;
}

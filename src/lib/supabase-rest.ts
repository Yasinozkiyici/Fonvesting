type FetchJsonOptions = {
  revalidate?: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  bypassCircuit?: boolean;
  countFailureForCircuit?: boolean;
};

type SupabaseRestCircuitState = {
  openUntil: number;
  consecutiveFailures: number;
  lastFailureAt: number;
};

const DEFAULT_TIMEOUT_MS = 3_500;
const DEFAULT_RETRIES = 0;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const CIRCUIT_OPEN_MS = 45_000;
const CIRCUIT_FAILURE_THRESHOLD = 2;
const FAILURE_STREAK_RESET_MS = 90_000;

declare global {
  var __supabaseRestCircuitState: SupabaseRestCircuitState | undefined;
}

function getCircuitState(): SupabaseRestCircuitState {
  if (!globalThis.__supabaseRestCircuitState) {
    globalThis.__supabaseRestCircuitState = {
      openUntil: 0,
      consecutiveFailures: 0,
      lastFailureAt: 0,
    };
  }
  return globalThis.__supabaseRestCircuitState;
}

function markSupabaseRestSuccess() {
  const state = getCircuitState();
  state.openUntil = 0;
  state.consecutiveFailures = 0;
  state.lastFailureAt = 0;
}

function markSupabaseRestFailure() {
  const state = getCircuitState();
  const now = Date.now();
  if (state.lastFailureAt === 0 || now - state.lastFailureAt > FAILURE_STREAK_RESET_MS) {
    state.consecutiveFailures = 0;
  }
  state.lastFailureAt = now;
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openUntil = now + CIRCUIT_OPEN_MS;
  }
}

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

  const useCircuit = options.bypassCircuit !== true;
  const countFailureForCircuit = options.countFailureForCircuit !== false;
  const circuit = getCircuitState();
  const now = Date.now();
  if (useCircuit && circuit.openUntil > now) {
    throw new Error(`supabase_rest_circuit_open_${circuit.openUntil - now}ms`);
  }
  if (useCircuit && circuit.openUntil !== 0 && circuit.openUntil <= now) {
    circuit.openUntil = 0;
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
        if (useCircuit) markSupabaseRestSuccess();
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
      if (useCircuit && countFailureForCircuit) markSupabaseRestFailure();
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

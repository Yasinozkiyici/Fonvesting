export type DbEnvFailureCategory =
  | "missing_database_url"
  | "missing_direct_url"
  | "invalid_database_url"
  | "unknown_env_config_error";

export type DbConnectionMode = "pooled" | "direct" | "unknown";

export type DbEnvStatus = {
  ok: boolean;
  configured: boolean;
  databaseUrlExists: boolean;
  directUrlExists: boolean;
  connectionMode: DbConnectionMode;
  failureCategory: DbEnvFailureCategory | null;
  failureDetail: string | null;
};

function inferConnectionMode(rawUrl: string): DbConnectionMode {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const pgbouncer = (url.searchParams.get("pgbouncer") ?? "").toLowerCase() === "true";
    if (host.includes("pooler.supabase.com") || pgbouncer) return "pooled";
    if (url.protocol === "postgresql:" || url.protocol === "postgres:") return "direct";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function sanitizeFailureDetail(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/(postgres(?:ql)?:\/\/)([^@\s]+)@/gi, "$1***:***@")
    .replace(/(password|token|secret|key)=([^&\s]+)/gi, "$1=***")
    .slice(0, 300);
}

export function getDbEnvStatus(options?: {
  requireDirectUrl?: boolean;
  directUrlMandatoryInProductionOnly?: boolean;
}): DbEnvStatus {
  const rawDb = (process.env.DATABASE_URL ?? "").trim();
  const rawDirect = (process.env.DIRECT_URL ?? "").trim();
  const isProd = process.env.NODE_ENV === "production";
  const requireDirect = options?.requireDirectUrl === true;
  const prodOnly = options?.directUrlMandatoryInProductionOnly ?? true;
  const directRequiredNow = requireDirect && (!prodOnly || isProd);

  if (!rawDb) {
    return {
      ok: false,
      configured: false,
      databaseUrlExists: false,
      directUrlExists: Boolean(rawDirect),
      connectionMode: "unknown",
      failureCategory: "missing_database_url",
      failureDetail: "DATABASE_URL is empty",
    };
  }

  try {
    const parsed = new URL(rawDb);
    const proto = parsed.protocol.toLowerCase();
    if (proto !== "postgresql:" && proto !== "postgres:" && proto !== "prisma:") {
      return {
        ok: false,
        configured: true,
        databaseUrlExists: true,
        directUrlExists: Boolean(rawDirect),
        connectionMode: "unknown",
        failureCategory: "invalid_database_url",
        failureDetail: `Unsupported DATABASE_URL protocol: ${proto}`,
      };
    }

    if (directRequiredNow && !rawDirect) {
      return {
        ok: false,
        configured: true,
        databaseUrlExists: true,
        directUrlExists: false,
        connectionMode: inferConnectionMode(rawDb),
        failureCategory: "missing_direct_url",
        failureDetail: "DIRECT_URL is required but empty",
      };
    }

    return {
      ok: true,
      configured: true,
      databaseUrlExists: true,
      directUrlExists: Boolean(rawDirect),
      connectionMode: inferConnectionMode(rawDb),
      failureCategory: null,
      failureDetail: null,
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      databaseUrlExists: true,
      directUrlExists: Boolean(rawDirect),
      connectionMode: "unknown",
      failureCategory: "invalid_database_url",
      failureDetail: sanitizeFailureDetail(error instanceof Error ? error.message : String(error)),
    };
  }
}


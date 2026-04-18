import {
  inferConnectionModeFromDatabaseUrl,
  readPrismaRuntimeDatabaseUrlRaw,
  readRawDatabaseUrlFromProcessEnv,
  readRawDirectUrlFromProcessEnv,
  type DbConnectionMode,
} from "@/lib/db/db-connection-profile";

export type { DbConnectionMode } from "@/lib/db/db-connection-profile";

export type DbEnvFailureCategory =
  | "missing_database_url"
  | "missing_direct_url"
  | "invalid_database_url"
  | "unknown_env_config_error";

export type DbEnvStatus = {
  ok: boolean;
  configured: boolean;
  databaseUrlExists: boolean;
  directUrlExists: boolean;
  connectionMode: DbConnectionMode;
  failureCategory: DbEnvFailureCategory | null;
  failureDetail: string | null;
};

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
  const rawRuntime = readPrismaRuntimeDatabaseUrlRaw();
  const rawDb = readRawDatabaseUrlFromProcessEnv();
  const rawDirect = readRawDirectUrlFromProcessEnv();
  const isProd = process.env.NODE_ENV === "production";
  const requireDirect = options?.requireDirectUrl === true;
  const prodOnly = options?.directUrlMandatoryInProductionOnly ?? true;
  const directRequiredNow = requireDirect && (!prodOnly || isProd);

  if (!rawRuntime) {
    return {
      ok: false,
      configured: false,
      databaseUrlExists: Boolean(rawDb),
      directUrlExists: Boolean(rawDirect),
      connectionMode: "unknown",
      failureCategory: "missing_database_url",
      failureDetail: "POSTGRES_PRISMA_URL and DATABASE_URL are both empty (runtime)",
    };
  }

  try {
    const parsed = new URL(rawRuntime);
    const proto = parsed.protocol.toLowerCase();
    if (proto !== "postgresql:" && proto !== "postgres:" && proto !== "prisma:") {
      return {
        ok: false,
        configured: true,
        databaseUrlExists: Boolean(rawDb),
        directUrlExists: Boolean(rawDirect),
        connectionMode: "unknown",
        failureCategory: "invalid_database_url",
        failureDetail: `Unsupported Prisma runtime URL protocol: ${proto}`,
      };
    }

    if (directRequiredNow && !rawDirect) {
      return {
        ok: false,
        configured: true,
        databaseUrlExists: Boolean(rawDb),
        directUrlExists: false,
        connectionMode: inferConnectionModeFromDatabaseUrl(rawRuntime),
        failureCategory: "missing_direct_url",
        failureDetail: "DIRECT_URL is required but empty",
      };
    }

    return {
      ok: true,
      configured: true,
      databaseUrlExists: Boolean(rawDb),
      directUrlExists: Boolean(rawDirect),
      connectionMode: inferConnectionModeFromDatabaseUrl(rawRuntime),
      failureCategory: null,
      failureDetail: null,
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      databaseUrlExists: Boolean(rawDb),
      directUrlExists: Boolean(rawDirect),
      connectionMode: "unknown",
      failureCategory: "invalid_database_url",
      failureDetail: sanitizeFailureDetail(error instanceof Error ? error.message : String(error)),
    };
  }
}

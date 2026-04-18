import { createHash } from "node:crypto";
import {
  inferConnectionModeFromDatabaseUrl,
  getPrismaRuntimeDatabaseUrlEnvKey,
  readRawDatabaseUrlFromProcessEnv,
  readRawDirectUrlFromProcessEnv,
  resolveDbRuntimeEnvPath,
  resolvePrismaDatasourceUrl,
} from "@/lib/db/db-connection-profile";

export type RuntimePathId = "homepage" | "health" | "cron";

export type DbRuntimeTargetDiagnostics = {
  path: RuntimePathId;
  env: {
    databaseUrlExists: boolean;
    directUrlExists: boolean;
    /** Prisma runtime için kazanan env anahtarı (POSTGRES_PRISMA_URL öncelikli). */
    resolvedFrom: "POSTGRES_PRISMA_URL" | "DATABASE_URL" | "none" | "dev_fallback";
  };
  fingerprint: {
    hostMasked: string | null;
    hostHash: string | null;
    dbMasked: string | null;
    dbHash: string | null;
  };
  connection: {
    mode: "data_proxy" | "supabase_pooler" | "direct_postgres" | "unknown";
    sslConfigured: boolean;
    pgbouncer: boolean;
    connectTimeoutSec: number | null;
    poolTimeoutSec: number | null;
    connectionLimit: number | null;
  };
};

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 10);
}

function maskToken(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return `${value[0] ?? ""}***`;
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function mapModeToDiagnosticsMode(
  inferred: ReturnType<typeof inferConnectionModeFromDatabaseUrl>,
  scheme: string
): DbRuntimeTargetDiagnostics["connection"]["mode"] {
  if (scheme === "prisma") return "data_proxy";
  if (inferred === "pooled") return "supabase_pooler";
  if (inferred === "direct") return "direct_postgres";
  return "unknown";
}

function parseResolvedUrl() {
  const effective = resolvePrismaDatasourceUrl();
  const parsed = new URL(effective);
  const host = parsed.hostname || "";
  const dbName = parsed.pathname.replace(/^\//, "") || "";
  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  const sslmode = (parsed.searchParams.get("sslmode") ?? "").toLowerCase();
  const pgbouncer = (parsed.searchParams.get("pgbouncer") ?? "").toLowerCase() === "true";
  const inferred = inferConnectionModeFromDatabaseUrl(effective);
  const mode = mapModeToDiagnosticsMode(inferred, scheme);
  return {
    host,
    dbName,
    mode,
    sslConfigured: ["require", "verify-full", "verify-ca"].includes(sslmode),
    pgbouncer,
    connectTimeoutSec: Number(parsed.searchParams.get("connect_timeout") ?? "") || null,
    poolTimeoutSec: Number(parsed.searchParams.get("pool_timeout") ?? "") || null,
    connectionLimit: Number(parsed.searchParams.get("connection_limit") ?? "") || null,
  };
}

export function getDbRuntimeTargetDiagnostics(path: RuntimePathId): DbRuntimeTargetDiagnostics {
  const rawDb = readRawDatabaseUrlFromProcessEnv();
  const rawDirect = readRawDirectUrlFromProcessEnv();
  const envPath = resolveDbRuntimeEnvPath();
  const prismaKey = getPrismaRuntimeDatabaseUrlEnvKey();
  const resolvedFrom = envPath === "database_url" ? prismaKey : "dev_fallback";
  try {
    const resolved = parseResolvedUrl();
    return {
      path,
      env: {
        databaseUrlExists: Boolean(rawDb),
        directUrlExists: Boolean(rawDirect),
        resolvedFrom,
      },
      fingerprint: {
        hostMasked: resolved.host ? maskToken(resolved.host) : null,
        hostHash: resolved.host ? shortHash(resolved.host) : null,
        dbMasked: resolved.dbName ? maskToken(resolved.dbName) : null,
        dbHash: resolved.dbName ? shortHash(resolved.dbName) : null,
      },
      connection: {
        mode: resolved.mode,
        sslConfigured: resolved.sslConfigured,
        pgbouncer: resolved.pgbouncer,
        connectTimeoutSec: resolved.connectTimeoutSec,
        poolTimeoutSec: resolved.poolTimeoutSec,
        connectionLimit: resolved.connectionLimit,
      },
    };
  } catch {
    return {
      path,
      env: {
        databaseUrlExists: Boolean(rawDb),
        directUrlExists: Boolean(rawDirect),
        resolvedFrom,
      },
      fingerprint: {
        hostMasked: null,
        hostHash: null,
        dbMasked: null,
        dbHash: null,
      },
      connection: {
        mode: "unknown",
        sslConfigured: false,
        pgbouncer: false,
        connectTimeoutSec: null,
        poolTimeoutSec: null,
        connectionLimit: null,
      },
    };
  }
}

/**
 * Sunucu loglarında şifre/host sızdırmadan tek satır DB hedef özeti (release / compare tanıları).
 */
export function tryFormatDbRuntimeEvidenceOneLiner(): string {
  try {
    const d = getDbRuntimeTargetDiagnostics("health");
    const prismaKey = getPrismaRuntimeDatabaseUrlEnvKey();
    return (
      `resolved_from=${d.env.resolvedFrom}` +
      ` prisma_env=${prismaKey}` +
      ` mode=${d.connection.mode}` +
      ` host_hash=${d.fingerprint.hostHash ?? "none"}` +
      ` ssl=${d.connection.sslConfigured ? 1 : 0}` +
      ` pgbouncer=${d.connection.pgbouncer ? 1 : 0}` +
      ` connect_timeout_s=${d.connection.connectTimeoutSec ?? "na"}` +
      ` pool_timeout_s=${d.connection.poolTimeoutSec ?? "na"}`
    );
  } catch {
    return "diagnostics_unavailable";
  }
}

export function areRuntimeTargetsIdentical(
  targets: DbRuntimeTargetDiagnostics[]
): { identical: boolean; referenceHostHash: string | null; referenceDbHash: string | null } {
  if (targets.length === 0) return { identical: true, referenceHostHash: null, referenceDbHash: null };
  const [first] = targets;
  const hostHash = first?.fingerprint.hostHash ?? null;
  const dbHash = first?.fingerprint.dbHash ?? null;
  const identical = targets.every(
    (item) =>
      item.fingerprint.hostHash === hostHash &&
      item.fingerprint.dbHash === dbHash &&
      item.connection.mode === first?.connection.mode
  );
  return { identical, referenceHostHash: hostHash, referenceDbHash: dbHash };
}

import { createHash } from "node:crypto";
import { getEffectiveDatabaseUrl } from "@/lib/prisma";

export type RuntimePathId = "homepage" | "health" | "cron";

export type DbRuntimeTargetDiagnostics = {
  path: RuntimePathId;
  env: {
    databaseUrlExists: boolean;
    directUrlExists: boolean;
    resolvedFrom: "DATABASE_URL" | "dev_fallback";
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

function parseResolvedUrl() {
  const effective = getEffectiveDatabaseUrl();
  const parsed = new URL(effective);
  const host = parsed.hostname || "";
  const dbName = parsed.pathname.replace(/^\//, "") || "";
  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  const sslmode = (parsed.searchParams.get("sslmode") ?? "").toLowerCase();
  const pgbouncer = (parsed.searchParams.get("pgbouncer") ?? "").toLowerCase() === "true";
  const hostLower = host.toLowerCase();
  const mode: DbRuntimeTargetDiagnostics["connection"]["mode"] =
    scheme === "prisma"
      ? "data_proxy"
      : hostLower.includes("pooler.supabase.com") || pgbouncer
        ? "supabase_pooler"
        : scheme === "postgresql" || scheme === "postgres"
          ? "direct_postgres"
          : "unknown";
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
  const rawDb = (process.env.DATABASE_URL ?? "").trim();
  const rawDirect = (process.env.DIRECT_URL ?? "").trim();
  const resolvedFrom = rawDb ? "DATABASE_URL" : "dev_fallback";
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

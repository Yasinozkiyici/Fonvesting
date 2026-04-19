import { createHash } from "node:crypto";

const globalDbUrlHints = globalThis as typeof globalThis & {
  __fonvDirectSupabaseDbUrlHintLogged?: boolean;
  __fonvPrismaDatasourceBootLogged?: boolean;
  __fonvProdlikeDirectPolicyErrorLogged?: boolean;
};

export function isSupabaseDirectDbHost(hostname: string, port: string): boolean {
  const host = hostname.toLowerCase();
  return host.startsWith("db.") && host.endsWith(".supabase.co") && (port === "" || port === "5432");
}

function warnDirectSupabaseRuntimeUrlOnce(hostname: string, port: string, runtimeEnvKey: string): void {
  if (globalDbUrlHints.__fonvDirectSupabaseDbUrlHintLogged) return;
  if (!isSupabaseDirectDbHost(hostname, port)) return;
  globalDbUrlHints.__fonvDirectSupabaseDbUrlHintLogged = true;
  console.warn(
    `[db-url-hint] Prisma runtime URL kaynağı=${runtimeEnvKey} doğrudan Supabase Postgres (db.*.supabase.co:5432); bazı ağlarda ` +
      "PrismaClientInitializationError / timeout görülebilir. Uygulama runtime için transaction pooler " +
      "(POSTGRES_PRISMA_URL veya DATABASE_URL → …pooler.supabase.com:6543?pgbouncer=true) kullanın; DIRECT_URL yalnızca migrate/ops. Bkz. .env.example."
  );
}

function warnPostgresPrismaUrlLooksDirectOnce(hostname: string, port: string): void {
  const g = globalDbUrlHints as typeof globalDbUrlHints & { __fonvPostgresPrismaDirectWarn?: boolean };
  if (g.__fonvPostgresPrismaDirectWarn) return;
  if (!isSupabaseDirectDbHost(hostname, port)) return;
  g.__fonvPostgresPrismaDirectWarn = true;
  console.warn(
    "[db-url-hint] POSTGRES_PRISMA_URL doğrudan db.*.supabase.co:5432 gösteriyor; bu anahtar genelde pooler olmalıdır. " +
      "Pooler URL’sini kullanın; DIRECT_URL migrate içindir."
  );
}

function shouldLogPrismaDatasourceBoot(): boolean {
  if (process.env.PRISMA_LOG_DATASOURCE_BOOT === "1") return true;
  if (process.env.PRISMA_LOG_DATASOURCE_BOOT === "0") return false;
  return process.env.PRODLIKE_VERIFICATION === "1";
}

function logPrismaDatasourceBootSummaryOnce(url: URL): void {
  if (globalDbUrlHints.__fonvPrismaDatasourceBootLogged) return;
  if (!shouldLogPrismaDatasourceBoot()) return;
  globalDbUrlHints.__fonvPrismaDatasourceBootLogged = true;
  const host = url.hostname || "";
  const port = url.port || "5432";
  const hostLower = host.toLowerCase();
  const mode =
    hostLower.includes("pooler.supabase.com") || url.searchParams.get("pgbouncer") === "true"
      ? "supabase_pooler"
      : hostLower.startsWith("db.") && hostLower.endsWith(".supabase.co")
        ? "supabase_direct_db_host"
        : "postgres_other";
  const ssl = (url.searchParams.get("sslmode") ?? "").toLowerCase();
  console.warn(
    `[prisma-datasource-boot] prisma_env=${getPrismaRuntimeDatabaseUrlEnvKey()} mode=${mode} port=${port} sslmode=${ssl || "defaulted"} ` +
      `connect_timeout=${url.searchParams.get("connect_timeout") ?? "na"} ` +
      `pool_timeout=${url.searchParams.get("pool_timeout") ?? "na"} ` +
      `connection_limit=${url.searchParams.get("connection_limit") ?? "na"}`
  );
}

/**
 * Runtime Prisma URL önceliği: POSTGRES_PRISMA_URL → DATABASE_URL → (yalnızca dev) localhost varsayılanı.
 * `schema.prisma` migrate için env("DATABASE_URL") okur; uygulama sorguları bu modülde override edilen URL ile çalışır.
 * DIRECT_URL yalnızca migrate/ops içindir.
 */
export const PRISMA_RUNTIME_DATASOURCE_ENV_KEY = "POSTGRES_PRISMA_URL|DATABASE_URL" as const;

export type DbConnectionMode = "pooled" | "direct" | "unknown";

export type DbRuntimeEnvPath = "database_url" | "dev_fallback";

export type PrismaRuntimeDatabaseUrlEnvKey = "POSTGRES_PRISMA_URL" | "DATABASE_URL" | "none";

export type DbConnectionProfile = {
  /** Ham process.env okuması (trim + paste kaçış temizliği). */
  rawDatabaseUrlPresent: boolean;
  rawDirectUrlPresent: boolean;
  envPath: DbRuntimeEnvPath;
  /** Prisma sorgu motorunun efektif URL için kullandığı env anahtarı. */
  prismaRuntimeEnvKey: PrismaRuntimeDatabaseUrlEnvKey;
  connectionMode: DbConnectionMode;
  effectiveDatasourceUrl: string;
  tuning: {
    pgbouncer: boolean;
    sslmode: string | null;
    connectTimeoutSec: number | null;
    poolTimeoutSec: number | null;
    connectionLimit: number | null;
  };
};

/**
 * Vercel/CLI yapıştırmada sık görülen: sondaki gerçek newline veya literal `\` + `n` iki karakteri.
 */
export function sanitizeConnectionStringEnvValue(raw: string | undefined | null): string {
  if (raw == null) return "";
  let s = String(raw).trim();
  // Literal backslash-n iki karakteri (çevre bazen `\n` string olarak ekler)
  s = s.replace(/\\n$/g, "").replace(/\\r$/g, "").trim();
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return s;
}

export function readRawDatabaseUrlFromProcessEnv(): string {
  return sanitizeConnectionStringEnvValue(process.env.DATABASE_URL);
}

/**
 * Prisma uygulama runtime’ı: Vercel + Supabase şablonlarında `POSTGRES_PRISMA_URL` genelde
 * transaction pooler (6543) olur; tanımlıysa `DATABASE_URL` öncesi kullanılır.
 * `DATABASE_URL` doğrudan `db.*.supabase.co:5432` iken yerel/CI ağlarında erişim sorunu yaşanırsa pooler buraya konur.
 */
function isLikelyPostgresJdbcUrl(raw: string): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "postgresql:" || u.protocol === "postgres:" || u.protocol === "prisma:";
  } catch {
    return false;
  }
}

export function readPrismaRuntimeDatabaseUrlRaw(): string {
  const prismaPooled = sanitizeConnectionStringEnvValue(process.env.POSTGRES_PRISMA_URL);
  if (prismaPooled) {
    if (isLikelyPostgresJdbcUrl(prismaPooled)) return prismaPooled;
    console.warn(
      "[db-url-hint] POSTGRES_PRISMA_URL tanımlı ama geçerli bir postgresql:/postgres:/prisma: URL değil; DATABASE_URL kullanılıyor."
    );
  }
  return readRawDatabaseUrlFromProcessEnv();
}

/** Hangi env anahtarının Prisma runtime URL’ine hükmettiği (log / tanı). `readPrismaRuntimeDatabaseUrlRaw` ile aynı mantık. */
export function getPrismaRuntimeDatabaseUrlEnvKey(): PrismaRuntimeDatabaseUrlEnvKey {
  const prismaPooled = sanitizeConnectionStringEnvValue(process.env.POSTGRES_PRISMA_URL);
  if (prismaPooled && isLikelyPostgresJdbcUrl(prismaPooled)) return "POSTGRES_PRISMA_URL";
  if (readRawDatabaseUrlFromProcessEnv()) return "DATABASE_URL";
  return "none";
}

/**
 * Prodlike: doğrudan db.*.supabase.co + yalnızca DATABASE_URL — kötü yapılandırma.
 * Varsayılan: tek sefer `console.error` (smoke’u policy ile kırmaz). Fail-fast için: PRODLIKE_STRICT_SUPABASE_RUNTIME=1.
 */
function enforceProdlikeSupabaseRuntimePolicy(
  url: URL,
  runtimeKey: ReturnType<typeof getPrismaRuntimeDatabaseUrlEnvKey>
): void {
  if (process.env.PRODLIKE_VERIFICATION !== "1") return;
  const h = (url.hostname || "").toLowerCase();
  const port = url.port || "5432";
  if (!isSupabaseDirectDbHost(h, port) || runtimeKey !== "DATABASE_URL") return;

  const msg =
    "[prisma-runtime-policy] PRODLIKE_VERIFICATION=1: Prisma runtime yalnızca DATABASE_URL üzerinden doğrudan " +
    "db.*.supabase.co:5432 hedefleniyor (çoğu ortamda P1001/timeout). Çözüm: POSTGRES_PRISMA_URL içine transaction " +
    "pooler URL’sini koyun (…pooler.supabase.com:6543?pgbouncer=true&sslmode=require) veya DATABASE_URL’i pooler yapın; " +
    "DIRECT_URL migrate/ops içindir. Bkz. .env.example.";

  if (String(process.env.PRODLIKE_STRICT_SUPABASE_RUNTIME ?? "").trim() === "1") {
    throw new Error(msg);
  }
  if (globalDbUrlHints.__fonvProdlikeDirectPolicyErrorLogged) return;
  globalDbUrlHints.__fonvProdlikeDirectPolicyErrorLogged = true;
  console.error(msg);
}

export function readRawDirectUrlFromProcessEnv(): string {
  return sanitizeConnectionStringEnvValue(process.env.DIRECT_URL);
}

export function inferConnectionModeFromDatabaseUrl(rawUrl: string): DbConnectionMode {
  if (!rawUrl) return "unknown";
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

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 10);
}

/** Log / header kanıtı: host/db adını sızdırmadan fingerprint. */
export function fingerprintConnectionUrl(urlStr: string): { hostHash: string | null; dbHash: string | null } {
  if (!urlStr) return { hostHash: null, dbHash: null };
  try {
    const u = new URL(urlStr);
    const host = u.hostname || "";
    const db = (u.pathname || "").replace(/^\//, "") || "";
    return {
      hostHash: host ? shortHash(host) : null,
      dbHash: db ? shortHash(db) : null,
    };
  } catch {
    return { hostHash: null, dbHash: null };
  }
}

/**
 * Prisma Client’ın kullanacağı nihai PostgreSQL URL’i (pooler parametreleri, ssl, timeout, connection_limit politikası).
 * Geliştirmede DATABASE_URL yoksa docker-compose varsayılanı (dev_fallback).
 */
export function resolvePrismaDatasourceUrl(): string {
  const raw = readPrismaRuntimeDatabaseUrlRaw();
  if (!raw) {
    if (process.env.NODE_ENV === "development") {
      return "postgresql://postgres:postgres@localhost:5433/fonvesting";
    }
    throw new Error(
      "Prisma runtime: POSTGRES_PRISMA_URL veya DATABASE_URL tanımlı değil (Vercel ve üretimde zorunlu)."
    );
  }
  if (raw.startsWith("file:")) {
    throw new Error(
      "DATABASE_URL SQLite (file:) kullanıyor; proje artık PostgreSQL kullanıyor. Bkz. .env.example ve docker-compose.yml."
    );
  }
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const isSupabasePooler =
      hostname.includes("pooler.supabase.com") || url.searchParams.get("pgbouncer") === "true";

    if (isSupabasePooler) {
      url.searchParams.set("pgbouncer", "true");
    }

    const ssl = (url.searchParams.get("sslmode") ?? "").trim().toLowerCase();
    if (ssl !== "require" && ssl !== "verify-full" && ssl !== "verify-ca") {
      url.searchParams.set("sslmode", "require");
    }

    const limitOverride = (process.env.DATABASE_CONNECTION_LIMIT ?? "").trim();
    const desiredDefault =
      process.env.NODE_ENV === "development"
        ? "12"
        : isSupabasePooler
          ? "1"
          : "5";
    const desired = limitOverride || desiredDefault;
    const current = url.searchParams.get("connection_limit")?.trim();
    // DATABASE_CONNECTION_LIMIT açıkça set edildiyse URL'deki (ör. secret'taki connection_limit=1) üzerine yaz.
    if (limitOverride) {
      url.searchParams.set("connection_limit", limitOverride);
    } else if (!current) {
      url.searchParams.set("connection_limit", desired);
    }

    const connectTimeout = Number(url.searchParams.get("connect_timeout") ?? "");
    if (!Number.isFinite(connectTimeout) || connectTimeout <= 0 || connectTimeout > 15) {
      url.searchParams.set("connect_timeout", "10");
    }
    const poolTimeoutOverride = (process.env.DATABASE_POOL_TIMEOUT ?? "").trim();
    const poolTimeoutNum = poolTimeoutOverride ? Number(poolTimeoutOverride) : NaN;
    if (poolTimeoutOverride && Number.isFinite(poolTimeoutNum) && poolTimeoutNum > 0) {
      const capped = Math.min(120, Math.max(1, Math.floor(poolTimeoutNum)));
      url.searchParams.set("pool_timeout", String(capped));
    } else {
      const poolTimeout = Number(url.searchParams.get("pool_timeout") ?? "");
      if (!Number.isFinite(poolTimeout) || poolTimeout <= 0 || poolTimeout > 20) {
        // Serverless altında uzun checkout beklemesi request kuyruk etkisi üretir.
        // Daha kısa timeout ile hızlı degrade + fallback yolu tercih edilir.
        url.searchParams.set("pool_timeout", "8");
      }
    }

    const runtimeKey = getPrismaRuntimeDatabaseUrlEnvKey();
    if (runtimeKey === "POSTGRES_PRISMA_URL") {
      warnPostgresPrismaUrlLooksDirectOnce(url.hostname, url.port);
    } else if (runtimeKey === "DATABASE_URL") {
      warnDirectSupabaseRuntimeUrlOnce(url.hostname, url.port, runtimeKey);
    }

    enforceProdlikeSupabaseRuntimePolicy(url, runtimeKey);

    logPrismaDatasourceBootSummaryOnce(url);

    return url.toString();
  } catch (error) {
    if (error instanceof Error && error.message.includes("[prisma-runtime-policy]")) {
      throw error;
    }
    return raw;
  }
}

export function resolveDbRuntimeEnvPath(): DbRuntimeEnvPath {
  return readPrismaRuntimeDatabaseUrlRaw() ? "database_url" : "dev_fallback";
}

export function resolveDbConnectionProfile(): DbConnectionProfile {
  const rawDb = readRawDatabaseUrlFromProcessEnv();
  const rawPrismaRuntime = readPrismaRuntimeDatabaseUrlRaw();
  const rawDirect = readRawDirectUrlFromProcessEnv();
  const envPath = resolveDbRuntimeEnvPath();
  const effectiveDatasourceUrl = resolvePrismaDatasourceUrl();
  const mode = inferConnectionModeFromDatabaseUrl(
    envPath === "dev_fallback" ? effectiveDatasourceUrl : rawPrismaRuntime || effectiveDatasourceUrl
  );
  let tuning: DbConnectionProfile["tuning"] = {
    pgbouncer: false,
    sslmode: null,
    connectTimeoutSec: null,
    poolTimeoutSec: null,
    connectionLimit: null,
  };
  try {
    const u = new URL(effectiveDatasourceUrl);
    tuning = {
      pgbouncer: (u.searchParams.get("pgbouncer") ?? "").toLowerCase() === "true",
      sslmode: u.searchParams.get("sslmode"),
      connectTimeoutSec: Number(u.searchParams.get("connect_timeout") ?? "") || null,
      poolTimeoutSec: Number(u.searchParams.get("pool_timeout") ?? "") || null,
      connectionLimit: Number(u.searchParams.get("connection_limit") ?? "") || null,
    };
  } catch {
    // ignore
  }
  return {
    rawDatabaseUrlPresent: Boolean(rawDb),
    rawDirectUrlPresent: Boolean(rawDirect),
    envPath,
    prismaRuntimeEnvKey: getPrismaRuntimeDatabaseUrlEnvKey(),
    connectionMode: mode,
    effectiveDatasourceUrl,
    tuning,
  };
}

/** @deprecated resolvePrismaDatasourceUrl kullanın; geriye dönük import uyumu için. */
export function getEffectiveDatabaseUrl(): string {
  return resolvePrismaDatasourceUrl();
}

import {
  fingerprintConnectionUrl,
  type DbConnectionMode,
  type DbRuntimeEnvPath,
  type PrismaRuntimeDatabaseUrlEnvKey,
} from "@/lib/db/db-connection-profile";

export type DbAccessResolutionLog = {
  tag: "db_access_resolution";
  route: string;
  prismaRuntimeEnvKey: PrismaRuntimeDatabaseUrlEnvKey;
  envPath: DbRuntimeEnvPath;
  connectionMode: DbConnectionMode;
  hostHash: string | null;
  dbHash: string | null;
  /** Örn. scores: snapshot | serving_discovery | … */
  chosenDataSource: string;
  degraded: boolean;
  degradedReason: string | null;
  dbFailureCategory: string | null;
};

/**
 * Tek satır yapılandırılmış kanıt: env yolu + bağlantı modu + seçilen veri kaynağı + degrade nedeni.
 */
export function logDbAccessResolution(entry: DbAccessResolutionLog): void {
  console.info(`[db_access_resolution] ${JSON.stringify(entry)}`);
}

export function buildDbAccessResolutionLog(input: {
  route: string;
  effectiveDatasourceUrl: string;
  envPath: DbRuntimeEnvPath;
  prismaRuntimeEnvKey: PrismaRuntimeDatabaseUrlEnvKey;
  connectionMode: DbConnectionMode;
  chosenDataSource: string;
  degraded: boolean;
  degradedReason: string | null;
  dbFailureCategory: string | null;
}): DbAccessResolutionLog {
  const fp = fingerprintConnectionUrl(input.effectiveDatasourceUrl);
  return {
    tag: "db_access_resolution",
    route: input.route,
    prismaRuntimeEnvKey: input.prismaRuntimeEnvKey,
    envPath: input.envPath,
    connectionMode: input.connectionMode,
    hostHash: fp.hostHash,
    dbHash: fp.dbHash,
    chosenDataSource: input.chosenDataSource,
    degraded: input.degraded,
    degradedReason: input.degradedReason,
    dbFailureCategory: input.dbFailureCategory,
  };
}

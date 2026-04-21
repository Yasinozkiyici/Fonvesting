import { PrismaClient } from "@prisma/client";
import { classifyDatabaseError } from "@/lib/database-error-classifier";
import { resolvePrismaDatasourceUrl } from "@/lib/db/db-connection-profile";

// Ortam değişkenleri: `next dev` / `next start` .env ve .env.local dosyalarını yükler.
// tsx ile çalışan scriptlerde önce `scripts/load-env` içe aktarılmalı (bkz. scripts/*.ts).

export {
  getEffectiveDatabaseUrl,
  resolvePrismaDatasourceUrl,
} from "@/lib/db/db-connection-profile";

const globalForPrisma = global as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    datasources: {
      db: {
        url: resolvePrismaDatasourceUrl(),
      },
    },
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", { emit: "event", level: "error" }]
        : [{ emit: "event", level: "error" }],
  });
  const globalForPrismaLogs = global as unknown as {
    __dbRuntimeLastErrorLog?: { key: string; at: number };
  };
  client.$on("error", (event) => {
    const classified = classifyDatabaseError(event.message);
    const now = Date.now();
    const dedupeKey = `${classified.category}|${classified.prismaCode ?? "none"}|${classified.message.slice(0, 120)}`;
    const last = globalForPrismaLogs.__dbRuntimeLastErrorLog;
    if (last && last.key === dedupeKey && now - last.at < 5_000) return;
    globalForPrismaLogs.__dbRuntimeLastErrorLog = { key: dedupeKey, at: now };
    console.warn(
      `[db-runtime-error] category=${classified.category} prisma_code=${classified.prismaCode ?? "none"} ` +
        `retryable=${classified.retryable ? 1 : 0} message=${classified.message}`
    );
  });
  return client;
}

function clientHasFundDelegate(client: PrismaClient): boolean {
  const typed = client as unknown as {
    fund?: unknown;
    macroSeries?: unknown;
    macroObservation?: unknown;
    macroSyncState?: unknown;
  };
  return (
    typeof typed.fund !== "undefined" &&
    typeof typed.macroSeries !== "undefined" &&
    typeof typed.macroObservation !== "undefined" &&
    typeof typed.macroSyncState !== "undefined"
  );
}

function getPrisma(): PrismaClient {
  const cached = globalForPrisma.prisma;
  if (cached && clientHasFundDelegate(cached)) {
    return cached;
  }
  if (cached && !clientHasFundDelegate(cached)) {
    void cached.$disconnect().catch(() => {});
    globalForPrisma.prisma = undefined;
  }
  const fresh = createPrismaClient();
  globalForPrisma.prisma = fresh;
  return fresh;
}

/**
 * Uzun süren batch job'larda pooler bağlantısı koptuğunda Prisma engine'i sıfırlamak için.
 * (Global singleton yeniden oluşturulur; bir sonraki sorgu yeni engine açar.)
 */
export async function resetPrismaEngine(): Promise<void> {
  const cached = globalForPrisma.prisma;
  globalForPrisma.prisma = undefined;
  if (!cached) return;
  await cached.$disconnect().catch(() => {});
}

/**
 * İlk özellik erişiminde engine oluşturulur; modül import’u sırasında gereksiz erken init azaltılır.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const real = getPrisma();
    const value = Reflect.get(real as unknown as object, prop, receiver);
    if (typeof value === "function") {
      return (value as (...a: unknown[]) => unknown).bind(real);
    }
    return value;
  },
}) as PrismaClient;

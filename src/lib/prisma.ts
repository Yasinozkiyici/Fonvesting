import { config } from "dotenv";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Next.js bazen modül yüklenirken .env henüz işlenmemiş olabiliyor; Prisma'dan önce yükle.
config({ path: path.join(process.cwd(), ".env"), quiet: true });
config({ path: path.join(process.cwd(), ".env.local"), override: true, quiet: true });

/**
 * PostgreSQL URL’ini döndürür. Geliştirmede DATABASE_URL yoksa docker-compose (5433) varsayılanı.
 * Eski SQLite `file:./dev.db` kullanıyorsanız .env’i PostgreSQL’e güncelleyin.
 */
export function getEffectiveDatabaseUrl(): string {
  const raw = (process.env.DATABASE_URL ?? "").trim();
  if (!raw) {
    if (process.env.NODE_ENV === "development") {
      return "postgresql://postgres:postgres@localhost:5433/fonvesting";
    }
    throw new Error("DATABASE_URL tanımlı değil (Vercel ve üretimde zorunlu).");
  }
  if (raw.startsWith("file:")) {
    throw new Error(
      "DATABASE_URL SQLite (file:) kullanıyor; proje artık PostgreSQL kullanıyor. Bkz. .env.example ve docker-compose.yml."
    );
  }
  return raw;
}

const globalForPrisma = global as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: getEffectiveDatabaseUrl(),
      },
    },
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

function clientHasFundDelegate(client: PrismaClient): boolean {
  return typeof (client as unknown as { fund?: unknown }).fund !== "undefined";
}

function getPrisma(): PrismaClient {
  const cached = globalForPrisma.prisma;
  if (cached && clientHasFundDelegate(cached)) {
    return cached;
  }
  // Eski HMR / yanlış bundle ile gelen client'ta delegate eksik kalabiliyor — yenile.
  if (cached && !clientHasFundDelegate(cached)) {
    void cached.$disconnect().catch(() => {});
    globalForPrisma.prisma = undefined;
  }
  const fresh = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = fresh;
  }
  return fresh;
}

export const prisma = getPrisma();

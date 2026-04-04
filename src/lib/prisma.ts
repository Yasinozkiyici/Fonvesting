import path from "node:path";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

// Next.js bazen modül yüklenirken .env henüz işlenmemiş olabiliyor; Prisma'dan önce yükle.
config({ path: path.join(process.cwd(), ".env"), quiet: true });
config({ path: path.join(process.cwd(), ".env.local"), override: true, quiet: true });

/**
 * SQLite için göreli file: yolunu mutlak file:/... yapar (Prisma doğrulaması + Next bundling).
 * Postgres URL ise olduğu gibi döner.
 */
export function getEffectiveDatabaseUrl(): string {
  const raw = (process.env.DATABASE_URL ?? "").trim();
  if (!raw) {
    const fallback = path.join(process.cwd(), "prisma", "dev.db");
    return `file:${fallback}`;
  }
  if (!raw.startsWith("file:")) {
    return raw;
  }
  let rest = raw.slice("file:".length).replace(/^\/+/, "");
  if (path.isAbsolute(rest)) {
    return `file:${rest}`;
  }
  rest = rest.replace(/^\.\//, "");
  const abs = path.resolve(process.cwd(), "prisma", rest);
  return `file:${abs}`;
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

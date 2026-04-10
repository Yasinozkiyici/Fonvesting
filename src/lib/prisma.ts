import { PrismaClient } from "@prisma/client";

// Ortam değişkenleri: `next dev` / `next start` .env ve .env.local dosyalarını yükler.
// tsx ile çalışan scriptlerde önce `scripts/load-env` içe aktarılmalı (bkz. scripts/*.ts).

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
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const isSupabasePooler =
      hostname.includes("pooler.supabase.com") || url.searchParams.get("pgbouncer") === "true";

    // Supabase transaction pooler kullanıyorsanız Prisma için zorunlu.
    if (isSupabasePooler) {
      url.searchParams.set("pgbouncer", "true");
    }

    // SSL Supabase ve çoğu managed Postgres için zorunlu; tanımlı değilse güvenli varsayılan uygula.
    const ssl = (url.searchParams.get("sslmode") ?? "").trim().toLowerCase();
    if (ssl !== "require" && ssl !== "verify-full" && ssl !== "verify-ca") {
      url.searchParams.set("sslmode", "require");
    }

    // Serverless ortamda bağlantı fırtınası yaşamamak için düşük bir connection_limit varsayılanı.
    // Not: Supabase pooler ile önerilir, ancak direct bağlantıda da "too many clients" riskini azaltır.
    const limit = (process.env.DATABASE_CONNECTION_LIMIT ?? "").trim();
    const desired = limit || "2";
    const current = url.searchParams.get("connection_limit")?.trim();
    if (!current) {
      url.searchParams.set("connection_limit", desired);
    }

    // Fail-fast: health/jobs endpoint'leri event-loop'u kilitlemesin.
    // URL'de daha uzun süre tanımlıysa override ederiz.
    const connectTimeout = Number(url.searchParams.get("connect_timeout") ?? "");
    if (!Number.isFinite(connectTimeout) || connectTimeout <= 0 || connectTimeout > 8) {
      url.searchParams.set("connect_timeout", "8");
    }
    const poolTimeout = Number(url.searchParams.get("pool_timeout") ?? "");
    if (!Number.isFinite(poolTimeout) || poolTimeout <= 0 || poolTimeout > 8) {
      url.searchParams.set("pool_timeout", "8");
    }

    return url.toString();
  } catch {
    return raw;
  }
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
  // Eski HMR / yanlış bundle ile gelen client'ta delegate eksik kalabiliyor — yenile.
  if (cached && !clientHasFundDelegate(cached)) {
    void cached.$disconnect().catch(() => {});
    globalForPrisma.prisma = undefined;
  }
  const fresh = createPrismaClient();
  // Serverless prod ortamında da tek client'ı runtime boyunca reuse etmek
  // connection storm/pool exhaustion riskini ciddi azaltır.
  globalForPrisma.prisma = fresh;
  return fresh;
}

export const prisma = getPrisma();

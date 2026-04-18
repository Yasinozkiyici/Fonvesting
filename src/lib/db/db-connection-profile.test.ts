import test from "node:test";
import assert from "node:assert/strict";
import {
  inferConnectionModeFromDatabaseUrl,
  readPrismaRuntimeDatabaseUrlRaw,
  readRawDatabaseUrlFromProcessEnv,
  resolvePrismaDatasourceUrl,
  sanitizeConnectionStringEnvValue,
} from "./db-connection-profile";

function withEnv<T>(vars: Record<string, string | undefined>, run: () => T): T {
  const backup = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(vars)) {
    backup.set(k, process.env[k]);
    if (typeof v === "undefined") delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return run();
  } finally {
    for (const [k, v] of backup.entries()) {
      if (typeof v === "undefined") delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("sanitizeConnectionStringEnvValue strips trailing newline and literal backslash-n", () => {
  assert.equal(sanitizeConnectionStringEnvValue("postgresql://a/b \n"), "postgresql://a/b");
  assert.equal(sanitizeConnectionStringEnvValue("postgresql://a/b\\n"), "postgresql://a/b");
  assert.equal(sanitizeConnectionStringEnvValue("postgresql://a/b\\r"), "postgresql://a/b");
});

test("inferConnectionModeFromDatabaseUrl: supabase pooler host", () => {
  assert.equal(
    inferConnectionModeFromDatabaseUrl(
      "postgresql://u:p@aws-0-eu.pooler.supabase.com:6543/postgres?sslmode=require"
    ),
    "pooled"
  );
});

test("readRawDatabaseUrlFromProcessEnv uses sanitize", () => {
  const url = "postgresql://postgres:pw@localhost:5433/fonvesting";
  withEnv({ DATABASE_URL: `${url}\n` }, () => {
    assert.equal(readRawDatabaseUrlFromProcessEnv(), url);
  });
});

test("readPrismaRuntimeDatabaseUrlRaw prefers POSTGRES_PRISMA_URL over DATABASE_URL", () => {
  const direct = "postgresql://postgres:pw@db.abc.supabase.co:5432/postgres?sslmode=require";
  const pooled = "postgresql://postgres:pw@aws-0-eu.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require";
  withEnv({ DATABASE_URL: direct, POSTGRES_PRISMA_URL: pooled }, () => {
    assert.equal(readPrismaRuntimeDatabaseUrlRaw(), pooled);
  });
});

test("invalid POSTGRES_PRISMA_URL falls back to DATABASE_URL", () => {
  const db = "postgresql://postgres:pw@localhost:5433/fonvesting";
  withEnv({ DATABASE_URL: db, POSTGRES_PRISMA_URL: "not-a-url" }, () => {
    assert.equal(readPrismaRuntimeDatabaseUrlRaw(), db);
  });
});

test("PRODLIKE_VERIFICATION: direct DATABASE_URL resolves; strict env throws", () => {
  const direct = "postgresql://postgres:pw@db.abc.supabase.co:5432/postgres?sslmode=require";
  withEnv(
    {
      PRODLIKE_VERIFICATION: "1",
      PRODLIKE_STRICT_SUPABASE_RUNTIME: "",
      NODE_ENV: "production",
      DATABASE_URL: direct,
      POSTGRES_PRISMA_URL: "",
    },
    () => {
      const u = resolvePrismaDatasourceUrl();
      assert.ok(u.includes("pooler") === false);
      assert.ok(u.includes("db.abc.supabase.co"));
    }
  );
  withEnv(
    {
      PRODLIKE_VERIFICATION: "1",
      PRODLIKE_STRICT_SUPABASE_RUNTIME: "1",
      NODE_ENV: "production",
      DATABASE_URL: direct,
      POSTGRES_PRISMA_URL: "",
    },
    () => {
      assert.throws(() => resolvePrismaDatasourceUrl(), /prisma-runtime-policy/);
    }
  );
});

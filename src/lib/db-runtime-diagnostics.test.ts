import test from "node:test";
import assert from "node:assert/strict";
import { tryFormatDbRuntimeEvidenceOneLiner } from "./db-runtime-diagnostics";

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

test("tryFormatDbRuntimeEvidenceOneLiner reflects pooler DATABASE_URL", () => {
  const line = withEnv(
    {
      DATABASE_URL:
        "postgresql://postgres.x:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require",
    },
    () => tryFormatDbRuntimeEvidenceOneLiner()
  );
  assert.match(line, /resolved_from=DATABASE_URL/);
  assert.match(line, /prisma_env=DATABASE_URL/);
  assert.match(line, /mode=supabase_pooler/);
  assert.match(line, /host_hash=[a-f0-9]+/);
  assert.match(line, /pgbouncer=1/);
});

test("tryFormatDbRuntimeEvidenceOneLiner reflects direct postgres host", () => {
  const line = withEnv(
    {
      DATABASE_URL:
        "postgresql://postgres:secret@db.abc123.supabase.co:5432/postgres?sslmode=require",
    },
    () => tryFormatDbRuntimeEvidenceOneLiner()
  );
  assert.match(line, /prisma_env=DATABASE_URL/);
  assert.match(line, /mode=direct_postgres/);
});

test("tryFormatDbRuntimeEvidenceOneLiner marks prisma_env when POSTGRES_PRISMA_URL wins", () => {
  const line = withEnv(
    {
      DATABASE_URL:
        "postgresql://postgres:secret@db.abc123.supabase.co:5432/postgres?sslmode=require",
      POSTGRES_PRISMA_URL:
        "postgresql://postgres:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require",
    },
    () => tryFormatDbRuntimeEvidenceOneLiner()
  );
  assert.match(line, /resolved_from=POSTGRES_PRISMA_URL/);
  assert.match(line, /prisma_env=POSTGRES_PRISMA_URL/);
  assert.match(line, /mode=supabase_pooler/);
});

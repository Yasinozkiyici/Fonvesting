import test from "node:test";
import assert from "node:assert/strict";
import { getDbEnvStatus, sanitizeFailureDetail } from "./db-env-validation";

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

test("env validation: missing DATABASE_URL classified", () => {
  const status = withEnv({ DATABASE_URL: "", DIRECT_URL: undefined }, () => getDbEnvStatus());
  assert.equal(status.ok, false);
  assert.equal(status.failureCategory, "missing_database_url");
});

test("env validation: invalid DATABASE_URL protocol classified", () => {
  const status = withEnv({ DATABASE_URL: "mysql://u:p@localhost/db" }, () => getDbEnvStatus());
  assert.equal(status.ok, false);
  assert.equal(status.failureCategory, "invalid_database_url");
});

test("env validation: pooled mode inferred from supabase pooler host", () => {
  const status = withEnv(
    {
      DATABASE_URL:
        "postgresql://postgres.ref:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require",
    },
    () => getDbEnvStatus()
  );
  assert.equal(status.ok, true);
  assert.equal(status.connectionMode, "pooled");
});

test("sanitizeFailureDetail redacts credentials and secrets", () => {
  const input =
    "Can't connect to postgresql://postgres:verysecret@db.example.com:5432/postgres?password=abc123&token=zzz";
  const out = sanitizeFailureDetail(input);
  assert.ok(out);
  assert.equal(out?.includes("verysecret"), false);
  assert.equal(out?.includes("abc123"), false);
  assert.equal(out?.includes("token=zzz"), false);
  assert.match(out ?? "", /postgresql:\/\/\*\*\*:\*\*\*@/);
});


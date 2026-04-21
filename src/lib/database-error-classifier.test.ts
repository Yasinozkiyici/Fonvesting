import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { classifyDatabaseError } from "./database-error-classifier";

test("PrismaClientInitializationError P1001 → network_unreachable", () => {
  const err = new Prisma.PrismaClientInitializationError(
    "Error code: P1001\nCan't reach database server at `db.example.com:5432`.",
    "client"
  );
  const c = classifyDatabaseError(err);
  assert.equal(c.category, "network_unreachable");
  assert.equal(c.prismaCode, "P1001");
  assert.equal(c.retryable, true);
});

test("PrismaClientInitializationError P1012 → invalid_datasource", () => {
  const err = new Prisma.PrismaClientInitializationError("Error code: P1012\nerror validating datasource", "client");
  const c = classifyDatabaseError(err);
  assert.equal(c.category, "invalid_datasource");
  assert.equal(c.prismaCode, "P1012");
});

test("Supavisor DbHandler exited → connection_closed (retryable)", () => {
  const c = classifyDatabaseError(new Error("FATAL: (EDBHANDLEREXITED) DbHandler exited"));
  assert.equal(c.category, "connection_closed");
  assert.equal(c.retryable, true);
});

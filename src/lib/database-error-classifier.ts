import { Prisma } from "@prisma/client";

export type DatabaseFailureCategory =
  | "pool_checkout_timeout"
  | "query_execution_timeout"
  | "transaction_timeout"
  | "connection_closed"
  | "connect_timeout"
  | "network_unreachable"
  | "auth_failed"
  | "invalid_datasource"
  | "unknown";

export type DatabaseFailureClassification = {
  category: DatabaseFailureCategory;
  prismaCode: string | null;
  message: string;
  retryable: boolean;
};

function getPrismaCode(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  if (error instanceof Prisma.PrismaClientInitializationError) {
    const fromProp = error.errorCode ?? null;
    if (fromProp) return fromProp;
    const match = /\b(P\d{4})\b/.exec(error.message);
    return match?.[1] ?? null;
  }
  return null;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || "error";
  return String(error);
}

export function classifyDatabaseError(error: unknown): DatabaseFailureClassification {
  const message = normalizeErrorMessage(error);
  const msg = message.toLowerCase();
  const prismaCode = getPrismaCode(error);

  if (
    prismaCode === "P2024" ||
    msg.includes("unable to check out connection from the pool") ||
    msg.includes("timed out fetching a new connection")
  ) {
    return { category: "pool_checkout_timeout", prismaCode, message, retryable: true };
  }

  if (
    prismaCode === "P2028" ||
    msg.includes("transaction already closed") ||
    msg.includes("expired transaction") ||
    msg.includes("timeout for this transaction")
  ) {
    return { category: "transaction_timeout", prismaCode, message, retryable: true };
  }

  if (
    prismaCode === "P1017" ||
    msg.includes("server has closed the connection") ||
    msg.includes("connection terminated unexpectedly") ||
    msg.includes("error in postgresql connection: error { kind: closed") ||
    // Supavisor / pooler bazen connector fatal ile bağlantıyı kapatır; kısa backoff + prisma reset ile toparlanabilir.
    msg.includes("edbhandlerexited") ||
    msg.includes("dbhandler exited")
  ) {
    return { category: "connection_closed", prismaCode, message, retryable: true };
  }

  if (msg.includes("canceling statement due to statement timeout") || msg.includes("statement timeout")) {
    return { category: "query_execution_timeout", prismaCode, message, retryable: true };
  }

  if (msg.includes("connect_timeout") || msg.includes("connection timeout") || msg.includes("connect timed out")) {
    return { category: "connect_timeout", prismaCode, message, retryable: true };
  }

  if (
    prismaCode === "P1001" ||
    msg.includes("can't reach database server") ||
    msg.includes("could not translate host name") ||
    msg.includes("enotfound") ||
    msg.includes("eai_again") ||
    msg.includes("connection refused")
  ) {
    return { category: "network_unreachable", prismaCode, message, retryable: true };
  }

  if (prismaCode === "P1012" || msg.includes("error validating datasource")) {
    return { category: "invalid_datasource", prismaCode, message, retryable: false };
  }

  if (msg.includes("password authentication failed") || msg.includes("authentication failed")) {
    return { category: "auth_failed", prismaCode, message, retryable: false };
  }

  return { category: "unknown", prismaCode, message, retryable: false };
}


type InvariantPayload = Record<string, unknown>;

function shouldFailInvariantInCurrentEnv(): boolean {
  if (process.env.FREEZE_INVARIANT_STRICT === "1") return true;
  if (process.env.FREEZE_INVARIANT_STRICT === "0") return false;
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.CI === "true") return true;
  return false;
}

export function guardSemanticInvariant(input: {
  scope: string;
  reason: string;
  payload?: InvariantPayload;
}): void {
  const message =
    `[semantic-invariant] scope=${input.scope} reason=${input.reason}` +
    (input.payload ? ` payload=${JSON.stringify(input.payload)}` : "");
  if (shouldFailInvariantInCurrentEnv()) {
    throw new Error(message);
  }
  console.error(message);
}


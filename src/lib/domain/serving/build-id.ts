import { createHash } from "node:crypto";

export type ServingBuildParts = {
  snapshotAsOfIso: string;
  gitCommitShort?: string | null;
  pipelineRunKey?: string | null;
};

/**
 * Deterministik build kimliği: aynı girdi → aynı id (uygulama sürümü commit ile süzülür).
 */
export function computeServingBuildId(parts: ServingBuildParts): string {
  const commit = (parts.gitCommitShort ?? "unknown").trim();
  const run = (parts.pipelineRunKey ?? "").trim();
  const basis = `${parts.snapshotAsOfIso}|${commit}|${run}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

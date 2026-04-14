type BuildFingerprint = {
  commitSha: string | null;
  commitShort: string | null;
  deploymentId: string | null;
  env: string | null;
  generatedAt: string;
};

function clean(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : null;
}

export function getBuildFingerprint(): BuildFingerprint {
  const commitSha =
    clean(process.env.VERCEL_GIT_COMMIT_SHA) ??
    clean(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA) ??
    clean(process.env.GIT_COMMIT_SHA);
  const deploymentId = clean(process.env.VERCEL_DEPLOYMENT_ID) ?? clean(process.env.VERCEL_URL);
  return {
    commitSha,
    commitShort: commitSha ? commitSha.slice(0, 8) : null,
    deploymentId,
    env: clean(process.env.VERCEL_ENV) ?? clean(process.env.NODE_ENV),
    generatedAt: new Date().toISOString(),
  };
}


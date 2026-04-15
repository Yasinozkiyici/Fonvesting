export const ReleaseClassification = Object.freeze({
  PRODUCT_BUG: "PRODUCT_BUG",
  TEST_BUG: "TEST_BUG",
  PREVIEW_AUTH_BLOCKER: "PREVIEW_AUTH_BLOCKER",
  ENV_CONFIG_BLOCKER: "ENV_CONFIG_BLOCKER",
  SHALLOW_VERIFICATION: "SHALLOW_VERIFICATION",
  RUNTIME_CLIENT_ASSET_FAILURE: "RUNTIME_CLIENT_ASSET_FAILURE",
});

export const ReleaseDecision = Object.freeze({
  GO: "GO",
  NO_GO: "NO_GO",
  RELEASE_BLOCKED: "RELEASE_BLOCKED",
});

export class ReleaseVerificationError extends Error {
  /**
   * @param {string} message
   * @param {{
   *   classification: string;
   *   decision: string;
   *   code: string;
   *   details?: string;
   * }} input
   */
  constructor(message, input) {
    super(message);
    this.name = "ReleaseVerificationError";
    this.classification = input.classification;
    this.decision = input.decision;
    this.code = input.code;
    this.details = input.details || "";
  }
}

/**
 * @param {unknown} error
 */
export function asReleaseVerificationError(error) {
  if (error instanceof ReleaseVerificationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ReleaseVerificationError(message, {
    classification: ReleaseClassification.TEST_BUG,
    decision: ReleaseDecision.NO_GO,
    code: "unexpected_script_failure",
  });
}

/**
 * @param {number} status
 */
export function isAuthBlockedStatus(status) {
  return status === 401 || status === 403;
}

/**
 * @param {{
 *   step: string;
 *   decision: string;
 *   classification: string;
 *   code: string;
 *   reason: string;
 *   details?: string;
 * }} input
 */
export function emitReleaseClassification(input) {
  const details = input.details ? ` details=${JSON.stringify(input.details)}` : "";
  console.log(
    `[release-classification] step=${input.step} decision=${input.decision} ` +
      `classification=${input.classification} code=${input.code} reason=${JSON.stringify(input.reason)}${details}`
  );
}

/**
 * @param {number} status
 * @param {string} url
 */
export function buildPreviewAuthBlocker(status, url) {
  return new ReleaseVerificationError(`preview authentication blocked (${status}) at ${url}`, {
    classification: ReleaseClassification.PREVIEW_AUTH_BLOCKER,
    decision: ReleaseDecision.RELEASE_BLOCKED,
    code: "preview_auth_blocked",
    details: `status=${status} url=${url}`,
  });
}

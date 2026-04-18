/**
 * Yapılandırılmış veri akışı kanıtı. Varsayılan kapalı — `DATA_FLOW_DIAGNOSTICS=1` ile açılır.
 */
export function logHomepageDataFlowEvidence(payload: Record<string, unknown>): void {
  if (process.env.DATA_FLOW_DIAGNOSTICS !== "1") return;
  try {
    console.info(`[data-flow:homepage] ${JSON.stringify(payload)}`);
  } catch {
    console.info("[data-flow:homepage] payload_serialize_failed");
  }
}

export function logDetailDataFlowEvidence(payload: Record<string, unknown>): void {
  if (process.env.DATA_FLOW_DIAGNOSTICS !== "1") return;
  try {
    console.info(`[data-flow:detail] ${JSON.stringify(payload)}`);
  } catch {
    console.info("[data-flow:detail] payload_serialize_failed");
  }
}

export function logCompareDataFlowEvidence(payload: Record<string, unknown>): void {
  if (process.env.DATA_FLOW_DIAGNOSTICS !== "1") return;
  try {
    console.info(`[data-flow:compare] ${JSON.stringify(payload)}`);
  } catch {
    console.info("[data-flow:compare] payload_serialize_failed");
  }
}

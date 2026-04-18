import { createHash } from "node:crypto";
import { BaseSourceAdapter } from "@/lib/ingestion/adapters/base-adapter";
import { pipelineLog } from "@/lib/ingestion/logging/pipeline-log";
import type { AdapterFetchResult, RawInsertPlan } from "@/lib/ingestion/types";
import { TefasBrowserClient } from "@/lib/services/tefas-browser.service";
import { startOfUtcDay } from "@/lib/trading-calendar-tr";

function checksumJson(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export class TefasPricesAdapter extends BaseSourceAdapter {
  readonly sourceId = "tefas_prices_v1";

  async fetch(input: {
    signal?: AbortSignal;
    mode?: "daily" | "historical";
    startDate?: Date;
    endDate?: Date;
    fundTypeCode?: 0 | 1;
    maxRetries?: number;
    retryBackoffMs?: number;
  } = {}): Promise<AdapterFetchResult> {
    const mode = input.mode ?? "daily";
    const maxRetries = Math.max(1, input.maxRetries ?? 3);
    const retryBackoffMs = Math.max(250, input.retryBackoffMs ?? 800);
    const startDate =
      mode === "historical"
        ? startOfUtcDay(input.startDate ?? new Date(Date.now() - 1095 * 24 * 60 * 60 * 1000))
        : startOfUtcDay(input.endDate ?? new Date());
    const endDate = startOfUtcDay(input.endDate ?? new Date());
    const fundTypeCode = input.fundTypeCode ?? 0;

    const client = new TefasBrowserClient();
    try {
      let attempt = 0;
      let lastError: string | null = null;
      while (attempt < maxRetries) {
        attempt += 1;
        if (input.signal?.aborted) throw new Error("tefas_fetch_aborted");
        try {
          const payload = await client.fetchPayload({
            fundTypeCode,
            fromDate: startDate,
            toDate: endDate,
          });
          const parseStatus = payload.ok ? "OK" : "FAILED";
          const parseError = payload.ok ? null : payload.error;
          const sourceKey = `${mode}:${fundTypeCode}:${startDate.toISOString().slice(0, 10)}:${endDate.toISOString().slice(0, 10)}`;
          const plan: RawInsertPlan = {
            source: "tefas_browser",
            sourceKey,
            effectiveDate: endDate,
            payload,
            checksum: checksumJson({ sourceKey, payload }),
            parseStatus,
            parseError,
          };
          pipelineLog({
            level: payload.ok ? "info" : "warn",
            phase: "ingestion",
            step: "tefas_prices_fetch",
            message: payload.ok ? "fetch_ok" : "fetch_error_payload",
            data: {
              sourceId: this.sourceId,
              mode,
              fundTypeCode,
              attempt,
              rows: payload.ok && "rows" in payload ? payload.rows.length : 0,
              parseError,
            },
          });
          return {
            plans: [plan],
            diagnostics: { mode, fundTypeCode, attempt, parseStatus, parseError },
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          if (attempt >= maxRetries) break;
          await new Promise((resolve) => setTimeout(resolve, retryBackoffMs * attempt));
        }
      }

      const failedPayload = {
        ok: false,
        error: lastError ?? "tefas_fetch_failed",
        mode,
        fundTypeCode,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      };
      const sourceKey = `${mode}:${fundTypeCode}:${startDate.toISOString().slice(0, 10)}:${endDate.toISOString().slice(0, 10)}`;
      return {
        plans: [
          {
            source: "tefas_browser",
            sourceKey,
            effectiveDate: endDate,
            payload: failedPayload,
            checksum: checksumJson({ sourceKey, failedPayload }),
            parseStatus: "FAILED",
            parseError: failedPayload.error,
          },
        ],
        diagnostics: { mode, fundTypeCode, attempt: maxRetries, parseStatus: "FAILED", parseError: failedPayload.error },
      };
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}

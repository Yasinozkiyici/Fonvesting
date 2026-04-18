import type { AdapterFetchResult } from "@/lib/ingestion/types";

export abstract class BaseSourceAdapter {
  abstract readonly sourceId: string;

  abstract fetch(input: { signal?: AbortSignal }): Promise<AdapterFetchResult>;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function readFundsArrayCount(payload: unknown): number {
  const root = asObject(payload);
  if (!root) return 0;
  const funds = root.funds;
  return Array.isArray(funds) ? funds.length : 0;
}

export type ServingUniverseIntegrityInput = {
  activeFundCount: number;
  listPayload: unknown;
  comparePayload: unknown;
  discoveryPayload: unknown;
  detailCountForBuild: number;
};

export type ServingUniverseIntegrity = {
  listCount: number;
  compareCount: number;
  discoveryCount: number;
  detailCount: number;
  coverageRatio: number;
  empty: boolean;
  sparse: boolean;
};

export function evaluateServingUniverseIntegrity(input: ServingUniverseIntegrityInput): ServingUniverseIntegrity {
  const listCount = readFundsArrayCount(input.listPayload);
  const compareCount = readFundsArrayCount(input.comparePayload);
  const discoveryCount = readFundsArrayCount(input.discoveryPayload);
  const detailCount = Math.max(0, Number.isFinite(input.detailCountForBuild) ? input.detailCountForBuild : 0);
  const activeFundCount = Math.max(0, input.activeFundCount);
  const coverageRatio = activeFundCount > 0 ? Number((listCount / activeFundCount).toFixed(4)) : 0;

  return {
    listCount,
    compareCount,
    discoveryCount,
    detailCount,
    coverageRatio,
    empty: listCount === 0 || compareCount === 0 || discoveryCount === 0 || detailCount === 0,
    sparse: activeFundCount > 0 && coverageRatio < 0.95,
  };
}

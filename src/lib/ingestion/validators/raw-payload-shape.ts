/** Minimum şekil denetimi — tam JSON Schema aşamasında genişletilecek. */
export function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length > 0);
}

export function assertPayloadObject(label: string, payload: unknown): Record<string, unknown> {
  if (!isNonEmptyRecord(payload)) {
    throw new Error(`${label}_payload_invalid`);
  }
  return payload;
}

export type RawPriceLikeRow = {
  code: string;
  date: string | Date;
  price: number;
};

function normalizeDate(value: string | Date): Date | null {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function assertRawPricePayloadRows(label: string, payload: unknown): RawPriceLikeRow[] {
  if (!Array.isArray(payload)) {
    throw new Error(`${label}_payload_not_array`);
  }
  if (payload.length === 0) {
    throw new Error(`${label}_payload_empty`);
  }

  const rows: RawPriceLikeRow[] = [];
  for (let i = 0; i < payload.length; i += 1) {
    const row = payload[i];
    if (!isNonEmptyRecord(row)) {
      throw new Error(`${label}_row_${i}_invalid`);
    }
    const code = String(row.code ?? "").trim().toUpperCase();
    const price = Number(row.price);
    const parsedDate = normalizeDate(row.date as string | Date);
    if (!code) throw new Error(`${label}_row_${i}_missing_code`);
    if (!parsedDate) throw new Error(`${label}_row_${i}_invalid_date`);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`${label}_row_${i}_invalid_price`);
    }
    rows.push({ code, date: parsedDate, price });
  }
  return rows;
}

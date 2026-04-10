import { startOfUtcDay } from "@/lib/trading-calendar-tr";

export type EvdsSeriesPoint = {
  date: Date;
  value: number;
  meta?: Record<string, unknown>;
};

export type EvdsFetchConfig = {
  seriesCode: string;
  valueField?: string;
  dateField?: string;
};

type EvdsPayload = Record<string, unknown>;

function formatEvdsDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

function sanitizeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEvdsDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let match = /^(\d{2})[.-](\d{2})[.-](\d{4})$/.exec(trimmed);
  if (match?.[1] && match[2] && match[3]) {
    return startOfUtcDay(new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]))));
  }

  match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (match?.[1] && match[2] && match[3]) {
    return startOfUtcDay(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
  }

  match = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (match?.[1] && match[2]) {
    return startOfUtcDay(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
  }

  return null;
}

function resolveRows(payload: EvdsPayload): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row));
  }

  const preferredKeys = ["items", "item", "data", "series", "results"];
  for (const key of preferredKeys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row));
    }
  }

  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) {
      return value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row));
    }
  }

  return [];
}

function inferDateField(row: Record<string, unknown>, explicit?: string): string | null {
  if (explicit && explicit in row) return explicit;
  const candidates = ["Tarih", "DATE", "date", "Date", "TARIH"];
  for (const key of candidates) {
    if (key in row) return key;
  }
  return Object.keys(row).find((key) => /tarih|date/i.test(key)) ?? null;
}

function inferValueField(row: Record<string, unknown>, seriesCode: string, explicit?: string): string | null {
  if (explicit && explicit in row) return explicit;
  if (seriesCode in row) return seriesCode;

  const normalizedTarget = sanitizeKey(seriesCode);
  const matchingKey = Object.keys(row).find((key) => sanitizeKey(key) === normalizedTarget);
  if (matchingKey) return matchingKey;

  return (
    Object.keys(row).find((key) => {
      if (/tarih|date/i.test(key)) return false;
      return parseNumber(row[key]) != null;
    }) ?? null
  );
}

function buildEvdsUrl(seriesCode: string, startDate: Date, endDate: Date): string {
  const template = process.env.TCMB_EVDS_URL_TEMPLATE;
  const replacements = {
    "{series}": encodeURIComponent(seriesCode),
    "{startDate}": encodeURIComponent(formatEvdsDate(startDate)),
    "{endDate}": encodeURIComponent(formatEvdsDate(endDate)),
  };

  if (template) {
    let out = template;
    for (const [needle, replacement] of Object.entries(replacements)) {
      out = out.replaceAll(needle, replacement);
    }
    return out;
  }

  const baseUrl = (process.env.TCMB_EVDS_BASE_URL ?? "https://evds2.tcmb.gov.tr/service/evds").replace(/\/$/, "");
  return `${baseUrl}/series=${encodeURIComponent(seriesCode)}?startDate=${formatEvdsDate(startDate)}&endDate=${formatEvdsDate(endDate)}&type=json`;
}

export async function fetchEvdsSeries(config: EvdsFetchConfig, startDate: Date, endDate: Date): Promise<EvdsSeriesPoint[]> {
  const apiKey = process.env.TCMB_EVDS_API_KEY;
  if (!apiKey) {
    throw new Error("TCMB_EVDS_API_KEY missing");
  }

  const response = await fetch(buildEvdsUrl(config.seriesCode, startDate, endDate), {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
      key: apiKey,
    },
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`EVDS HTTP ${response.status} (${config.seriesCode})`);
  }
  if (/<!DOCTYPE html>/i.test(text)) {
    throw new Error(`EVDS returned HTML (${config.seriesCode})`);
  }

  let payload: EvdsPayload;
  try {
    payload = JSON.parse(text) as EvdsPayload;
  } catch {
    throw new Error(`EVDS invalid JSON (${config.seriesCode})`);
  }

  const rows = resolveRows(payload);
  if (rows.length === 0) {
    return [];
  }

  const sample = rows[0];
  if (!sample) return [];

  const dateField = inferDateField(sample, config.dateField);
  const valueField = inferValueField(sample, config.seriesCode, config.valueField);
  if (!dateField || !valueField) {
    throw new Error(`EVDS fields unresolved (${config.seriesCode})`);
  }

  const points = new Map<number, EvdsSeriesPoint>();
  for (const row of rows) {
    const date = parseEvdsDate(row[dateField]);
    const value = parseNumber(row[valueField]);
    if (!date || value == null) continue;

    points.set(date.getTime(), {
      date,
      value,
      meta: {
        sourceSeriesCode: config.seriesCode,
        rawDateField: dateField,
        rawValueField: valueField,
      },
    });
  }

  return [...points.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

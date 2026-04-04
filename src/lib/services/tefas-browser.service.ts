import { setTimeout as sleep } from "node:timers/promises";
import { parseTefasSessionDate } from "@/lib/trading-calendar-tr";
import type { Browser, BrowserContext, Page } from "playwright";

const TEFAS_PAGE_URL = "https://www.tefas.gov.tr/TarihselVeriler.aspx";
const TEFAS_HISTORY_URL = "https://www.tefas.gov.tr/api/DB/BindHistoryInfo";
const PAGE_TIMEOUT_MS = 120_000;
const MAX_REQUESTS_PER_SESSION = 24;
const DEFAULT_RETRY_COUNT = 3;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

export type TefasExportRow = {
  date?: string | null;
  code: string;
  name: string;
  shortName?: string | null;
  lastPrice: number;
  previousPrice: number;
  dailyReturn: number;
  portfolioSize: number;
  investorCount: number;
  shareCount: number;
};

export type TefasExportPayload =
  | { ok: false; error: string }
  | { ok: true; empty: true; date: string; fromDate?: string | null; toDate?: string | null; fundTypeCode: number }
  | { ok: true; empty?: false; date: string; fromDate?: string | null; toDate?: string | null; fundTypeCode: number; rows: TefasExportRow[] };

type TefasFundTypeCode = 0 | 1;

type RawTefasRow = {
  TARIH?: string | number | null;
  FONKODU?: string | null;
  FONUNVAN?: string | null;
  FIYAT?: number | string | null;
  TEDPAYSAYISI?: number | string | null;
  KISISAYISI?: number | string | null;
  PORTFOYBUYUKLUK?: number | string | null;
};

type RawTefasResponse = {
  draw?: number;
  recordsTotal?: number;
  recordsFiltered?: number;
  data?: RawTefasRow[];
};

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const normalized =
      trimmed.includes(",") && trimmed.includes(".") && trimmed.lastIndexOf(",") > trimmed.lastIndexOf(".")
        ? trimmed.replace(/\./g, "").replace(",", ".")
        : trimmed.replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toInteger(value: unknown): number {
  return Math.trunc(toNumber(value));
}

function formatIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatTefasDate(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${date.getUTCFullYear()}`;
}

function normalizePayloadDate(input: string | Date): { iso: string; tefas: string } {
  if (input instanceof Date) {
    return { iso: formatIsoDate(input), tefas: formatTefasDate(input) };
  }
  const parsed = parseTefasSessionDate(input) ?? new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Geçersiz TEFAS tarihi: ${input}`);
  }
  return { iso: formatIsoDate(parsed), tefas: formatTefasDate(parsed) };
}

function mapFundTypeCode(fundTypeCode: number): "YAT" | "EMK" {
  if (fundTypeCode === 0) return "YAT";
  if (fundTypeCode === 1) return "EMK";
  throw new Error(`Desteklenmeyen TEFAS fon tipi: ${fundTypeCode}`);
}

function normalizeRawRow(row: RawTefasRow): TefasExportRow | null {
  const code = String(row.FONKODU ?? "")
    .trim()
    .toUpperCase();
  const name = String(row.FONUNVAN ?? "").trim();
  const lastPrice = toNumber(row.FIYAT);
  if (!code || !name || lastPrice <= 0) return null;

  const sessionDate = row.TARIH != null ? new Date(Number(row.TARIH)) : null;
  const date = sessionDate && !Number.isNaN(sessionDate.getTime()) ? formatTefasDate(sessionDate) : null;

  return {
    date,
    code,
    name,
    shortName: code,
    lastPrice,
    previousPrice: 0,
    dailyReturn: 0,
    portfolioSize: toNumber(row.PORTFOYBUYUKLUK),
    investorCount: toInteger(row.KISISAYISI),
    shareCount: toInteger(row.TEDPAYSAYISI),
  };
}

export class TefasBrowserClient {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private requestCount = 0;

  private async launchSession(): Promise<void> {
    const { chromium } = await import("playwright");
    this.browser = await chromium.launch({
      headless: process.env.TEFAS_HEADLESS !== "0",
      args: ["--disable-blink-features=AutomationControlled"],
    });
    this.context = await this.browser.newContext({
      locale: "tr-TR",
      timezoneId: "Europe/Istanbul",
      userAgent: USER_AGENT,
      viewport: { width: 1440, height: 900 },
    });
    this.page = await this.context.newPage();
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["tr-TR", "tr", "en-US", "en"] });
      Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
    });
    await this.page.goto(TEFAS_PAGE_URL, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
    const title = await this.page.title();
    if (title.toLowerCase().includes("request rejected")) {
      throw new Error("TEFAS WAF isteği reddetti.");
    }
    this.requestCount = 0;
  }

  private async resetSession(): Promise<void> {
    await this.page?.close().catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = null;
    this.context = null;
    this.browser = null;
    this.requestCount = 0;
  }

  private async ensureSession(forceReset: boolean = false): Promise<Page> {
    if (forceReset || this.requestCount >= MAX_REQUESTS_PER_SESSION) {
      await this.resetSession();
    }
    if (!this.page) {
      await this.launchSession();
    }
    return this.page as Page;
  }

  async close(): Promise<void> {
    await this.resetSession();
  }

  async fetchPayload(input: {
    fundTypeCode: TefasFundTypeCode;
    date?: string | Date;
    fromDate?: string | Date;
    toDate?: string | Date;
    fundCode?: string | null;
  }): Promise<TefasExportPayload> {
    const singleDate = input.date ? normalizePayloadDate(input.date) : null;
    const fromDate = input.fromDate ? normalizePayloadDate(input.fromDate) : singleDate;
    const toDate = input.toDate ? normalizePayloadDate(input.toDate) : singleDate;

    if (!fromDate || !toDate) {
      throw new Error("TEFAS fetch için tarih gerekli.");
    }

    const fundCode = input.fundCode?.trim().toUpperCase() || "";
    const fontip = mapFundTypeCode(input.fundTypeCode);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= DEFAULT_RETRY_COUNT; attempt += 1) {
      try {
        const page = await this.ensureSession(attempt > 1);
        const raw = await page.evaluate(
          async ({ url, fontip, fundCode, fromDate, toDate }) => {
            const body = new URLSearchParams({
              fontip,
              fonkod: fundCode,
              bastarih: fromDate,
              bittarih: toDate,
            });
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "X-Requested-With": "XMLHttpRequest",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                Accept: "application/json, text/javascript, */*; q=0.01",
              },
              credentials: "include",
              body,
            });
            return {
              status: response.status,
              text: await response.text(),
            };
          },
          {
            url: TEFAS_HISTORY_URL,
            fontip,
            fundCode,
            fromDate: fromDate.iso,
            toDate: toDate.iso,
          }
        );

        if (raw.status !== 200) {
          throw new Error(`TEFAS ${raw.status}: ${raw.text.slice(0, 300)}`);
        }
        if (raw.text.includes("Request Rejected")) {
          throw new Error("TEFAS WAF isteği reddetti.");
        }

        const parsed = JSON.parse(raw.text) as RawTefasResponse;
        const rows = (parsed.data ?? [])
          .map((row) => normalizeRawRow(row))
          .filter((row): row is TefasExportRow => row != null);

        this.requestCount += 1;

        if (rows.length === 0) {
          return {
            ok: true,
            empty: true,
            date: toDate.tefas,
            fromDate: fromDate.tefas,
            toDate: toDate.tefas,
            fundTypeCode: input.fundTypeCode,
          };
        }

        return {
          ok: true,
          date: toDate.tefas,
          fromDate: fromDate.tefas,
          toDate: toDate.tefas,
          fundTypeCode: input.fundTypeCode,
          rows,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await this.resetSession();
        await sleep(750 * attempt);
      }
    }

    return {
      ok: false,
      error: lastError?.message ?? "TEFAS fetch başarısız oldu.",
    };
  }
}

export async function withTefasBrowserClient<T>(fn: (client: TefasBrowserClient) => Promise<T>): Promise<T> {
  const client = new TefasBrowserClient();
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

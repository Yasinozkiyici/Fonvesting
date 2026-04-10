import { startOfUtcDay } from "@/lib/trading-calendar-tr";

export type TcmbSeriesPoint = {
  date: Date;
  value: number;
};

const TCMB_ONE_WEEK_REPO_URL =
  "https://tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Temel+Faaliyetler/Para+Politikasi/Merkez+Bankasi+Faiz+Oranlari/1+Hafta+Repo";
const TCMB_CPI_URL =
  "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB%20TR/Main%20Menu/Istatistikler/Enflasyon%20Verileri/Tuketici%20Fiyatlari";

function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let normalized = trimmed;

  if (trimmed.includes(",") && trimmed.includes(".")) {
    normalized = trimmed.replace(/\./g, "").replace(",", ".");
  } else if (trimmed.includes(",")) {
    normalized = trimmed.replace(",", ".");
  } else if (/^\d+\.\d{1,2}$/.test(trimmed)) {
    normalized = trimmed;
  } else {
    normalized = trimmed.replace(/\./g, "");
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function parseTurkishDay(raw: string): Date | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw.trim());
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return startOfUtcDay(new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]))));
}

function parseMonthYear(raw: string): Date | null {
  const match = /^(\d{2})-(\d{4})$/.exec(raw.trim());
  if (!match?.[1] || !match[2]) return null;
  return startOfUtcDay(new Date(Date.UTC(Number(match[2]), Number(match[1]) - 1, 1)));
}

function withinRange(date: Date, startDate: Date, endDate: Date): boolean {
  const time = date.getTime();
  return time >= startOfUtcDay(startDate).getTime() && time <= startOfUtcDay(endDate).getTime();
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`TCMB page HTTP ${response.status}`);
  }
  return response.text();
}

export async function fetchTcmbOneWeekRepoRange(startDate: Date, endDate: Date): Promise<TcmbSeriesPoint[]> {
  const html = await fetchHtml(TCMB_ONE_WEEK_REPO_URL);
  const rows = [...html.matchAll(/<tr>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>[^<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<\/tr>/gi)];
  const points = new Map<number, TcmbSeriesPoint>();

  for (const row of rows) {
    const dateRaw = row[1]?.trim() ?? "";
    const valueRaw = row[2]?.trim() ?? "";
    if (!dateRaw || !valueRaw || valueRaw === "-") continue;

    const date = parseTurkishDay(dateRaw);
    const value = parseNumber(valueRaw);
    if (!date || value == null || !withinRange(date, startDate, endDate)) continue;

    points.set(date.getTime(), { date, value });
  }

  return [...points.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export async function fetchTcmbCpiRange(
  startDate: Date,
  endDate: Date,
  metric: "yearly" | "monthly"
): Promise<TcmbSeriesPoint[]> {
  const html = await fetchHtml(TCMB_CPI_URL);
  const rows = [...html.matchAll(/<tr>\s*<td[^>]*>(\d{2}-\d{4})<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<\/tr>/gi)];
  const points = new Map<number, TcmbSeriesPoint>();

  for (const row of rows) {
    const monthRaw = row[1]?.trim() ?? "";
    const yearlyRaw = row[2]?.trim() ?? "";
    const monthlyRaw = row[3]?.trim() ?? "";
    const date = parseMonthYear(monthRaw);
    const value = parseNumber(metric === "yearly" ? yearlyRaw : monthlyRaw);
    if (!date || value == null || !withinRange(date, startDate, endDate)) continue;

    points.set(date.getTime(), { date, value });
  }

  return [...points.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

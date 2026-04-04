/**
 * İki farklı günün TEFAS verilerini karşılaştırarak dailyReturn hesaplar
 * Ayrıca döviz kurlarını da günceller
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

async function fetchExchangeRates(): Promise<{ usdTry: number; eurTry: number } | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await res.json();
    if (data.result !== "success") return null;
    const usdTry = data.rates?.TRY ?? 0;
    const eurRate = data.rates?.EUR ?? 1;
    const eurTry = usdTry / eurRate;
    return { usdTry, eurTry };
  } catch {
    return null;
  }
}

const prisma = new PrismaClient();

function resolvePythonBin(root: string): string {
  const venvUnix = path.join(root, "scripts", ".venv", "bin", "python3");
  const venvWin = path.join(root, "scripts", ".venv", "Scripts", "python.exe");
  if (fs.existsSync(venvUnix)) return venvUnix;
  if (fs.existsSync(venvWin)) return venvWin;
  return process.platform === "win32" ? "python" : "python3";
}

type ExportRow = {
  code: string;
  name: string;
  lastPrice: number;
  portfolioSize: number;
  investorCount: number;
};

type ExportPayload =
  | { ok: false; error: string }
  | { ok: true; empty: true }
  | { ok: true; empty?: false; rows: ExportRow[] };

function fetchTefasData(date: string, fundType: number = 0): Map<string, ExportRow> | null {
  const root = process.cwd();
  const script = path.join(root, "scripts", "tefas_export.py");
  const py = resolvePythonBin(root);

  try {
    const out = execFileSync(py, [script, "--fund-type", String(fundType), "--date", date], {
      cwd: root,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120000,
    });
    const payload = JSON.parse(out.trim()) as ExportPayload;
    if (!payload.ok || payload.empty || !("rows" in payload)) return null;

    const map = new Map<string, ExportRow>();
    for (const row of payload.rows) {
      map.set(row.code, row);
    }
    return map;
  } catch (e) {
    console.error("TEFAS fetch error:", e);
    return null;
  }
}

function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function getPreviousWorkday(d: Date): Date {
  const prev = new Date(d);
  prev.setDate(prev.getDate() - 1);
  // Skip weekends
  while (prev.getDay() === 0 || prev.getDay() === 6) {
    prev.setDate(prev.getDate() - 1);
  }
  return prev;
}

async function main() {
  const today = new Date();
  // Get last two workdays
  let currentDay = today;
  // If today is weekend, go back to Friday
  while (currentDay.getDay() === 0 || currentDay.getDay() === 6) {
    currentDay.setDate(currentDay.getDate() - 1);
  }
  const previousDay = getPreviousWorkday(currentDay);

  const currentDateStr = formatDate(currentDay);
  const previousDateStr = formatDate(previousDay);

  console.log(`Fetching TEFAS data for ${previousDateStr} (previous) and ${currentDateStr} (current)...`);

  console.log(`\nFetching ${previousDateStr}...`);
  const prevData = fetchTefasData(previousDateStr);
  if (!prevData) {
    console.error("Could not fetch previous day data");
    process.exit(1);
  }
  console.log(`Got ${prevData.size} funds`);

  console.log(`\nFetching ${currentDateStr}...`);
  const currData = fetchTefasData(currentDateStr);
  if (!currData) {
    console.error("Could not fetch current day data");
    process.exit(1);
  }
  console.log(`Got ${currData.size} funds`);

  console.log("\nCalculating daily returns and updating database...");

  let updated = 0;
  let skipped = 0;

  for (const [code, curr] of currData) {
    const prev = prevData.get(code);
    if (!prev || prev.lastPrice <= 0 || curr.lastPrice <= 0) {
      skipped++;
      continue;
    }

    const dailyReturn = ((curr.lastPrice - prev.lastPrice) / prev.lastPrice) * 100;

    // Skip unreasonable values
    if (!Number.isFinite(dailyReturn) || Math.abs(dailyReturn) > 50) {
      skipped++;
      continue;
    }

    await prisma.fund.updateMany({
      where: { code },
      data: {
        lastPrice: curr.lastPrice,
        previousPrice: prev.lastPrice,
        dailyReturn: Number(dailyReturn.toFixed(4)),
        portfolioSize: curr.portfolioSize,
        investorCount: curr.investorCount,
      },
    });
    updated++;
  }

  // Fetch exchange rates
  console.log("\nFetching exchange rates...");
  const rates = await fetchExchangeRates();
  if (rates) {
    console.log(`USD/TRY: ${rates.usdTry.toFixed(4)}, EUR/TRY: ${rates.eurTry.toFixed(4)}`);
  }

  // Update market snapshot
  const funds = await prisma.fund.findMany({
    where: { isActive: true },
    select: { dailyReturn: true, portfolioSize: true, investorCount: true },
  });

  const advancers = funds.filter((f) => f.dailyReturn > 0).length;
  const decliners = funds.filter((f) => f.dailyReturn < 0).length;
  const unchanged = funds.length - advancers - decliners;
  const rets = funds.map((f) => f.dailyReturn).filter((x) => x !== 0);
  const avgReturn = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  await prisma.marketSnapshot.upsert({
    where: { date: dayStart },
    create: {
      date: dayStart,
      totalFundCount: funds.length,
      totalPortfolioSize: funds.reduce((s, f) => s + f.portfolioSize, 0),
      totalInvestorCount: funds.reduce((s, f) => s + f.investorCount, 0),
      avgDailyReturn: avgReturn,
      advancers,
      decliners,
      unchanged,
      usdTry: rates?.usdTry ?? null,
      eurTry: rates?.eurTry ?? null,
    },
    update: {
      totalFundCount: funds.length,
      totalPortfolioSize: funds.reduce((s, f) => s + f.portfolioSize, 0),
      totalInvestorCount: funds.reduce((s, f) => s + f.investorCount, 0),
      avgDailyReturn: avgReturn,
      advancers,
      decliners,
      unchanged,
      usdTry: rates?.usdTry ?? undefined,
      eurTry: rates?.eurTry ?? undefined,
    },
  });

  console.log(`\nDone! Updated ${updated} funds, skipped ${skipped}`);
  console.log(`Market: ${advancers} advancers, ${decliners} decliners, ${unchanged} unchanged`);
  console.log(`Average daily return: ${avgReturn.toFixed(4)}%`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

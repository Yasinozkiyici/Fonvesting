/**
 * Son 7 iş gününün TEFAS verilerini çekip FundPriceHistory tablosuna kaydeder
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function resolvePythonBin(root: string): string {
  const venvUnix = path.join(root, "scripts", ".venv", "bin", "python3");
  const venvWin = path.join(root, "scripts", ".venv", "Scripts", "python.exe");
  if (fs.existsSync(venvUnix)) return venvUnix;
  if (fs.existsSync(venvWin)) return venvWin;
  return process.platform === "win32" ? "python" : "python3";
}

function formatDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

function getLastNBusinessDays(n: number): Date[] {
  const dates: Date[] = [];
  const today = new Date();
  let current = new Date(today);
  
  while (dates.length < n) {
    const dayOfWeek = current.getDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      dates.push(new Date(current));
    }
    current.setDate(current.getDate() - 1);
  }
  
  return dates.reverse(); // Oldest first
}

interface TefasRecord {
  code: string;
  lastPrice: number;
}

async function fetchTefasForDate(pythonBin: string, scriptPath: string, dateStr: string): Promise<TefasRecord[]> {
  console.log(`  Fetching TEFAS data for ${dateStr}...`);
  
  try {
    const raw = execFileSync(pythonBin, [scriptPath, "--date", dateStr], {
      encoding: "utf-8",
      maxBuffer: 100 * 1024 * 1024,
      timeout: 120_000,
    });

    const data = JSON.parse(raw);
    if (!data.ok || !Array.isArray(data.funds)) {
      console.log(`    No data for ${dateStr}`);
      return [];
    }

    return data.funds
      .filter((f: any) => f.code && f.lastPrice > 0)
      .map((f: any) => ({
        code: f.code,
        lastPrice: f.lastPrice,
      }));
  } catch (err) {
    console.log(`    Error fetching ${dateStr}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const pythonBin = resolvePythonBin(root);
  const scriptPath = path.join(root, "scripts", "tefas_export.py");

  console.log("=== Fetching 7 Business Days of TEFAS Price History ===\n");

  // Get last 7 business days
  const dates = getLastNBusinessDays(7);
  console.log("Target dates:", dates.map(d => formatDate(d)).join(", "));
  console.log("");

  // Get all fund codes from DB
  const funds = await prisma.fund.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
  });
  const fundMap = new Map(funds.map(f => [f.code, f.id]));
  console.log(`Found ${funds.length} active funds in database\n`);

  // Fetch data for each date
  let totalRecords = 0;
  
  for (const date of dates) {
    const dateStr = formatDate(date);
    const records = await fetchTefasForDate(pythonBin, scriptPath, dateStr);
    
    if (records.length === 0) {
      console.log(`    Skipping ${dateStr} - no data\n`);
      continue;
    }

    console.log(`    Got ${records.length} records for ${dateStr}`);

    // Upsert price history records
    let inserted = 0;
    for (const rec of records) {
      const fundId = fundMap.get(rec.code);
      if (!fundId) continue;

      try {
        await prisma.fundPriceHistory.upsert({
          where: {
            fundId_date: {
              fundId,
              date,
            },
          },
          update: {
            price: rec.lastPrice,
          },
          create: {
            fundId,
            date,
            price: rec.lastPrice,
          },
        });
        inserted++;
      } catch {
        // Ignore duplicate errors
      }
    }

    console.log(`    Inserted/Updated ${inserted} price history records\n`);
    totalRecords += inserted;
  }

  // Check final state
  const historyCount = await prisma.fundPriceHistory.count();
  const dateCount = await prisma.fundPriceHistory.groupBy({
    by: ["date"],
    _count: true,
  });

  console.log("=== Summary ===");
  console.log(`Total price history records: ${historyCount}`);
  console.log(`Unique dates: ${dateCount.length}`);
  console.log(`Records added this run: ${totalRecords}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Son 7 iş gününün TEFAS verilerini çekip FundPriceHistory tablosuna kaydeder
 */
import { PrismaClient } from "@prisma/client";
import { TefasBrowserClient, withTefasBrowserClient } from "../src/lib/services/tefas-browser.service";

const prisma = new PrismaClient();

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

async function fetchTefasForDate(client: TefasBrowserClient, date: Date, fundTypeCode: 0 | 1): Promise<TefasRecord[]> {
  const dateStr = formatDate(date);
  console.log(`  Fetching TEFAS data for ${dateStr}...`);

  try {
    const data = await client.fetchPayload({ fundTypeCode, date });
    if (!data.ok || ("empty" in data && data.empty) || !("rows" in data)) {
      console.log(`    No data for ${dateStr}`);
      return [];
    }

    return data.rows
      .filter((f) => f.code && f.lastPrice > 0)
      .map((f) => ({
        code: f.code,
        lastPrice: f.lastPrice,
      }));
  } catch (err) {
    console.log(`    Error fetching ${dateStr}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

async function main() {
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

  await withTefasBrowserClient(async (client) => {
    for (const date of dates) {
      const dateStr = formatDate(date);
      const merged = new Map<string, TefasRecord>();

      for (const fundTypeCode of [0, 1] as const) {
        const records = await fetchTefasForDate(client, date, fundTypeCode);
        for (const record of records) {
          merged.set(record.code, record);
        }
      }

      if (merged.size === 0) {
        console.log(`    Skipping ${dateStr} - no data\n`);
        continue;
      }

      console.log(`    Got ${merged.size} records for ${dateStr}`);

      let inserted = 0;
      for (const rec of merged.values()) {
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
  });

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

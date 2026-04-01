import { prisma } from "@/lib/prisma";
import { fetchAllBistCompanies } from "@/lib/services/bist-companies.service";
import { BIST100_SYMBOLS, BIST30_SYMBOLS } from "@/lib/services/bist-index-symbols";
import { fetchBistQuotes } from "@/lib/services/yahoo-finance.service";
import { getSectorCodeForCompany } from "@/lib/services/bist-sector-map";
import YahooFinance from "yahoo-finance2";

const DEFAULT_SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 saat
const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});
const MAX_LISTED_EQUITIES = 521;

let lastSyncAt = 0;
let inFlightSync: Promise<void> | null = null;
const MAX_REASONABLE_MARKET_CAP_TRY = 20_000_000_000_000; // 20 Trilyon TL

const SECTORS = [
  { code: "XUSIN", name: "BIST Sınai", description: "BIST Sınai Endeksi", color: "#10B981" },
  { code: "XSINS", name: "BIST Sınai Ağırlık Sınırlamalı", description: "BIST Sınai Ağırlık Sınırlamalı Endeksi", color: "#34D399" },
  { code: "XUHIZ", name: "BIST Hizmet", description: "BIST Hizmet Endeksi", color: "#06B6D4" },
  { code: "XUMAL", name: "BIST Mali", description: "BIST Mali Endeksi", color: "#0EA5E9" },
  { code: "XUTEK", name: "BIST Teknoloji", description: "BIST Teknoloji Endeksi", color: "#6366F1" },
  { code: "XTKS", name: "BIST Teknoloji Ağırlık Sınırlı", description: "BIST Teknoloji Ağırlık Sınırlı Endeksi", color: "#818CF8" },
  { code: "XBANK", name: "BIST Banka", description: "BIST Banka Endeksi", color: "#3B82F6" },
  { code: "XAKUR", name: "BIST Aracı Kurumlar", description: "BIST Aracı Kurumlar Endeksi", color: "#2563EB" },
  { code: "XBLSM", name: "BIST Bilişim", description: "BIST Bilişim Endeksi", color: "#7C3AED" },
  { code: "XELKT", name: "BIST Elektrik", description: "BIST Elektrik Endeksi", color: "#F97316" },
  { code: "XFINK", name: "BIST Fin. Kir. Faktoring", description: "BIST Finansal Kiralama ve Faktoring Endeksi", color: "#0284C7" },
  { code: "XGMYO", name: "BIST Gayrimenkul Y.O", description: "BIST Gayrimenkul Yatırım Ortaklığı Endeksi", color: "#A855F7" },
  { code: "XGYOS", name: "BIST Gayrimenkul Y.O. Ağırlık", description: "BIST Gayrimenkul Y.O. Ağırlık Endeksi", color: "#C084FC" },
  { code: "XGIDA", name: "BIST Gıda İçecek", description: "BIST Gıda İçecek Endeksi", color: "#F59E0B" },
  { code: "XHOLD", name: "BIST Holding ve Yatırım", description: "BIST Holding ve Yatırım Endeksi", color: "#8B5CF6" },
  { code: "XILTM", name: "BIST İletişim", description: "BIST İletişim Endeksi", color: "#EC4899" },
  { code: "XINSA", name: "BIST İnşaat", description: "BIST İnşaat Endeksi", color: "#84CC16" },
  { code: "XKAGT", name: "BIST Orman Kağıt Basım", description: "BIST Orman Kağıt Basım Endeksi", color: "#65A30D" },
  { code: "XKMYA", name: "BIST Kimya Petrol Plastik", description: "BIST Kimya Petrol Plastik Endeksi", color: "#EA580C" },
  { code: "XMADN", name: "BIST Madencilik", description: "BIST Madencilik Endeksi", color: "#B45309" },
  { code: "XYORT", name: "BIST Menkul Kıym. Y.O.", description: "BIST Menkul Kıymet Yatırım Ortaklığı Endeksi", color: "#0891B2" },
  { code: "XMANA", name: "BIST Metal Ana", description: "BIST Metal Ana Endeksi", color: "#64748B" },
  { code: "XMESY", name: "BIST Metal Eşya Makina", description: "BIST Metal Eşya Makina Endeksi", color: "#0F766E" },
  { code: "XSGRT", name: "BIST Sigorta", description: "BIST Sigorta Endeksi", color: "#0EA5E9" },
  { code: "XSPOR", name: "BIST Spor", description: "BIST Spor Endeksi", color: "#DC2626" },
  { code: "XTAST", name: "BIST Taş Toprak", description: "BIST Taş Toprak Endeksi", color: "#D97706" },
  { code: "XTEKS", name: "BIST Tekstil Deri", description: "BIST Tekstil Deri Endeksi", color: "#DB2777" },
  { code: "XTRCT", name: "BIST Ticaret", description: "BIST Ticaret Endeksi", color: "#16A34A" },
  { code: "XTRZM", name: "BIST Turizm", description: "BIST Turizm Endeksi", color: "#14B8A6" },
  { code: "XULAS", name: "BIST Ulaştırma", description: "BIST Ulaştırma Endeksi", color: "#0D9488" },
] as const;

async function ensureSeedSectors() {
  await Promise.all(
    SECTORS.map((sector) =>
      prisma.sector.upsert({
        where: { code: sector.code },
        update: {
          name: sector.name,
          description: sector.description,
          color: sector.color,
        },
        create: sector,
      })
    )
  );
}

async function ensureIndices() {
  await prisma.index.upsert({
    where: { code: "XU100" },
    update: { name: "BIST 100", description: "Borsa İstanbul 100 Endeksi" },
    create: { code: "XU100", name: "BIST 100", description: "Borsa İstanbul 100 Endeksi" },
  });
  await prisma.index.upsert({
    where: { code: "XU030" },
    update: { name: "BIST 30", description: "Borsa İstanbul 30 Endeksi" },
    create: { code: "XU030", name: "BIST 30", description: "Borsa İstanbul 30 Endeksi" },
  });
}

function resolveSyncIntervalMs() {
  const hours = Number(process.env.YAHOO_SYNC_INTERVAL_HOURS ?? "4");
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_SYNC_INTERVAL_MS;
  return hours * 60 * 60 * 1000;
}

function shouldSyncNow(force: boolean) {
  if (force) return true;
  const interval = resolveSyncIntervalMs();
  return Date.now() - lastSyncAt >= interval;
}

function sanitizeMarketCap(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  if (value > MAX_REASONABLE_MARKET_CAP_TRY) return null;
  return value;
}

export async function syncYahooStocksIfStale(options?: { force?: boolean }) {
  const force = options?.force ?? false;
  await ensureSeedSectors();
  await ensureIndices();

  const existingStockCount = await prisma.stock.count({ where: { isActive: true } });
  if (!shouldSyncNow(force) && existingStockCount >= 300) return;
  if (inFlightSync) {
    await inFlightSync;
    return;
  }

  inFlightSync = (async () => {
    try {
      const companies = (await fetchAllBistCompanies()).slice(0, MAX_LISTED_EQUITIES);
      const allSymbols = companies.map((company) => company.symbol);

      // 521 sonrasi kayitlar fon vb. oldugu icin aktif listeden cikar.
      await prisma.stock.updateMany({
        where: {
          isActive: true,
          symbol: { notIn: allSymbols },
        },
        data: { isActive: false },
      });

      await Promise.all(
        companies.map((company) =>
          prisma.stock.upsert({
            where: { symbol: company.symbol },
            update: { isActive: true },
            create: {
              symbol: company.symbol,
              name: company.name,
              shortName: company.symbol,
              logoUrl: company.logoUrl,
              isActive: true,
              isTrading: true,
            },
          })
        )
      );

      const stocks = await prisma.stock.findMany({
        where: { isActive: true },
        select: {
          id: true,
          symbol: true,
          name: true,
          shortName: true,
          logoUrl: true,
          sectorId: true,
          lastPrice: true,
          previousClose: true,
          change: true,
          changePercent: true,
          marketCap: true,
          volume: true,
          turnover: true,
          week52High: true,
          week52Low: true,
          peRatio: true,
        },
      });

      if (stocks.length === 0) {
        lastSyncAt = Date.now();
        return;
      }

      const sectors = await prisma.sector.findMany({
        select: { id: true, code: true },
      });
      const sectorIdByCode = new Map(sectors.map((sector) => [sector.code, sector.id]));

      const stocksBySymbol = new Map(stocks.map((s) => [s.symbol, s]));
      const companyBySymbol = new Map(companies.map((company) => [company.symbol, company]));
      const quotes = await fetchBistQuotes(allSymbols);
      const updatedAt = new Date();

      await Promise.all(
        allSymbols.map(async (symbol) => {
          const stock = stocksBySymbol.get(symbol);
          if (!stock) return;

          const company = companyBySymbol.get(symbol);
          const companyName = company?.name ?? stock.name;
          const sectorId =
            sectorIdByCode.get(getSectorCodeForCompany(symbol, companyName)) ?? stock.sectorId ?? null;
          const live = quotes[symbol];
          if (!live) {
            await prisma.stock.update({
              where: { id: stock.id },
              data: {
                name: company?.name ?? stock.name,
                shortName: stock.shortName ?? symbol,
                logoUrl: company?.logoUrl ?? stock.logoUrl,
                sectorId,
              },
            });
            return;
          }

          const nextPrice = live.regularMarketPrice ?? stock.lastPrice;
          const nextChangePercent = live.regularMarketChangePercent ?? stock.changePercent;
          const safeLiveMarketCap = sanitizeMarketCap(live.marketCap);
          const safeStoredMarketCap = sanitizeMarketCap(stock.marketCap);
          const nextMarketCap = safeLiveMarketCap ?? safeStoredMarketCap ?? 0;
          const nextVolume = live.regularMarketVolume ?? stock.volume;

          const nextPreviousClose =
            nextPrice && nextChangePercent !== null && nextChangePercent > -100
              ? nextPrice / (1 + nextChangePercent / 100)
              : stock.previousClose;

          const nextChange = nextPrice - nextPreviousClose;
          const nextTurnover = nextPrice * nextVolume;

          await prisma.stock.update({
            where: { id: stock.id },
            data: {
              lastPrice: nextPrice,
              previousClose: Number.isFinite(nextPreviousClose) ? nextPreviousClose : stock.previousClose,
              change: Number.isFinite(nextChange) ? nextChange : stock.change,
              changePercent: nextChangePercent,
              marketCap: nextMarketCap,
              volume: nextVolume,
              turnover: Number.isFinite(nextTurnover) ? nextTurnover : stock.turnover,
              week52High: live.fiftyTwoWeekHigh ?? stock.week52High,
              week52Low: live.fiftyTwoWeekLow ?? stock.week52Low,
              peRatio: live.trailingPE ?? stock.peRatio,
              shortName: live.shortName ?? stock.shortName,
              name: live.longName ?? company?.name ?? live.shortName ?? stock.name,
              logoUrl: company?.logoUrl ?? stock.logoUrl,
              sectorId,
              lastTradeAt: updatedAt,
            },
          });
        })
      );

      const [bist100Index, bist30Index] = await Promise.all([
        prisma.index.findUnique({ where: { code: "XU100" }, select: { id: true } }),
        prisma.index.findUnique({ where: { code: "XU030" }, select: { id: true } }),
      ]);

      if (bist100Index && bist30Index) {
        await prisma.stockIndex.deleteMany({
          where: { indexId: { in: [bist100Index.id, bist30Index.id] } },
        });

        const relationData: Array<{ stockId: string; indexId: string; weight: number }> = [];
        for (const symbol of BIST100_SYMBOLS) {
          const stock = stocksBySymbol.get(symbol);
          if (stock) {
            relationData.push({ stockId: stock.id, indexId: bist100Index.id, weight: 1 });
          }
        }
        for (const symbol of BIST30_SYMBOLS) {
          const stock = stocksBySymbol.get(symbol);
          if (stock) {
            relationData.push({ stockId: stock.id, indexId: bist30Index.id, weight: 1 });
          }
        }

        if (relationData.length > 0) {
          await prisma.stockIndex.createMany({ data: relationData });
        }
      }

      const [xu100Quote, xu030Quote, usdTryQuote, eurTryQuote] = await Promise.all([
        yahooFinance.quote("XU100.IS", {
          fields: [
            "regularMarketPrice",
            "regularMarketChange",
            "regularMarketChangePercent",
            "regularMarketVolume",
          ],
        }),
        yahooFinance.quote("XU030.IS", {
          fields: [
            "regularMarketPrice",
            "regularMarketChange",
            "regularMarketChangePercent",
            "regularMarketVolume",
          ],
        }),
        yahooFinance.quote("TRY=X", { fields: ["regularMarketPrice"] }),
        yahooFinance.quote("EURTRY=X", { fields: ["regularMarketPrice"] }),
      ]);

      const bist100Value =
        typeof xu100Quote.regularMarketPrice === "number" ? xu100Quote.regularMarketPrice : 0;
      const bist100Change =
        typeof xu100Quote.regularMarketChange === "number" ? xu100Quote.regularMarketChange : 0;
      const bist100ChangePercent =
        typeof xu100Quote.regularMarketChangePercent === "number"
          ? xu100Quote.regularMarketChangePercent
          : 0;
      const bist100Volume =
        typeof xu100Quote.regularMarketVolume === "number" ? xu100Quote.regularMarketVolume : 0;

      const bist30Value =
        typeof xu030Quote.regularMarketPrice === "number" ? xu030Quote.regularMarketPrice : 0;
      const bist30Change =
        typeof xu030Quote.regularMarketChange === "number" ? xu030Quote.regularMarketChange : 0;
      const bist30ChangePercent =
        typeof xu030Quote.regularMarketChangePercent === "number"
          ? xu030Quote.regularMarketChangePercent
          : 0;
      const bist30Volume =
        typeof xu030Quote.regularMarketVolume === "number" ? xu030Quote.regularMarketVolume : 0;

      await prisma.index.updateMany({
        where: { code: "XU100" },
        data: {
          lastValue: bist100Value,
          change: bist100Change,
          changePercent: bist100ChangePercent,
          volume: bist100Volume,
        },
      });
      await prisma.index.updateMany({
        where: { code: "XU030" },
        data: {
          lastValue: bist30Value,
          change: bist30Change,
          changePercent: bist30ChangePercent,
          volume: bist30Volume,
        },
      });

      const totals = await prisma.stock.aggregate({
        where: { isActive: true },
        _sum: {
          marketCap: true,
          volume: true,
          turnover: true,
        },
      });

      const advancers = await prisma.stock.count({
        where: { isActive: true, changePercent: { gt: 0 } },
      });
      const decliners = await prisma.stock.count({
        where: { isActive: true, changePercent: { lt: 0 } },
      });
      const activeCount = await prisma.stock.count({ where: { isActive: true } });
      const unchanged = Math.max(0, activeCount - advancers - decliners);

      await prisma.marketSnapshot.create({
        data: {
          date: updatedAt,
          bist100Value,
          bist100Change,
          bist100Volume,
          totalMarketCap: totals._sum.marketCap ?? 0,
          totalVolume: totals._sum.volume ?? 0,
          advancers,
          decliners,
          unchanged,
          usdTry:
            typeof usdTryQuote.regularMarketPrice === "number"
              ? usdTryQuote.regularMarketPrice
              : null,
          eurTry:
            typeof eurTryQuote.regularMarketPrice === "number"
              ? eurTryQuote.regularMarketPrice
              : null,
        },
      });

      lastSyncAt = Date.now();
      console.info(`[yahoo-sync] Completed. Updated ${allSymbols.length} stocks.`);
    } catch (error) {
      console.error("[yahoo-sync] Failed:", error);
    } finally {
      inFlightSync = null;
    }
  })();

  await inFlightSync;
}

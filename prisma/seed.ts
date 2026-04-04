import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.watchlistItem.deleteMany();
  await prisma.watchlist.deleteMany();
  await prisma.user.deleteMany();
  await prisma.fundPriceHistory.deleteMany();
  await prisma.fund.deleteMany();
  await prisma.syncLog.deleteMany();
  await prisma.marketSnapshot.deleteMany();
  await prisma.fundCategory.deleteMany();
  await prisma.fundType.deleteMany();

  const types = await Promise.all([
    prisma.fundType.create({
      data: { code: 0, name: "Yatırım Fonları", description: "TEFAS yatırım fonları" },
    }),
    prisma.fundType.create({
      data: { code: 1, name: "Emeklilik Fonları (BES)", description: "BES fonları" },
    }),
  ]);

  const cats = await Promise.all([
    prisma.fundCategory.create({
      data: { code: "PPF", name: "Para Piyasası Fonu", color: "#3B82F6" },
    }),
    prisma.fundCategory.create({
      data: { code: "HSF", name: "Hisse Senedi Fonu", color: "#10B981" },
    }),
  ]);

  const t0 = types[0]!.id;
  const demo = [
    {
      code: "TI1",
      name: "Örnek Para Piyasası Fonu",
      categoryId: cats[0]!.id,
      portfolioSize: 15e9,
      investorCount: 120_000,
      lastPrice: 0.045,
      dailyReturn: 0.02,
    },
    {
      code: "AFT",
      name: "Örnek Hisse Fonu",
      categoryId: cats[1]!.id,
      portfolioSize: 8e9,
      investorCount: 85_000,
      lastPrice: 2.45,
      dailyReturn: 1.2,
    },
  ];

  for (const d of demo) {
    await prisma.fund.create({
      data: {
        ...d,
        shortName: d.code,
        fundTypeId: t0,
        previousPrice: d.lastPrice * (1 - d.dailyReturn / 100),
        lastUpdatedAt: new Date(),
      },
    });
  }

  const day = new Date();
  day.setHours(0, 0, 0, 0);
  await prisma.marketSnapshot.create({
    data: {
      date: day,
      totalFundCount: 2,
      totalPortfolioSize: 23e9,
      totalInvestorCount: 205_000,
      avgDailyReturn: 0.61,
      advancers: 1,
      decliners: 0,
      unchanged: 1,
    },
  });

  console.log("Seed tamam (örnek fonlar). TEFAS için: npx tsx scripts/sync-tefas.ts");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding BISTMarketCap database...");

  // Idempotent seed: önce ilişkili verileri güvenli sırayla temizle
  await prisma.watchlistItem.deleteMany();
  await prisma.watchlist.deleteMany();
  await prisma.user.deleteMany();
  await prisma.stockNews.deleteMany();
  await prisma.news.deleteMany();
  await prisma.financialStatement.deleteMany();
  await prisma.dividend.deleteMany();
  await prisma.priceHistory.deleteMany();
  await prisma.indexPriceHistory.deleteMany();
  await prisma.stockIndex.deleteMany();
  await prisma.marketSnapshot.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.index.deleteMany();
  await prisma.sector.deleteMany();

  // Sektörler (BIST sektör endeksleri)
  const sectorSeeds = [
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

  const sectors = await Promise.all(
    sectorSeeds.map((sector) =>
      prisma.sector.create({
        data: sector,
      })
    )
  );

  console.log(`✅ Created ${sectors.length} sectors`);

  // Endeksler
  const indices = await Promise.all([
    prisma.index.create({
      data: {
        code: "XU100",
        name: "BIST 100",
        description: "Borsa İstanbul 100 Endeksi",
        lastValue: 9850.25,
        change: 125.50,
        changePercent: 1.29,
      },
    }),
    prisma.index.create({
      data: {
        code: "XU030",
        name: "BIST 30",
        description: "Borsa İstanbul 30 Endeksi",
        lastValue: 10250.80,
        change: 145.20,
        changePercent: 1.44,
      },
    }),
    prisma.index.create({
      data: {
        code: "XU050",
        name: "BIST 50",
        description: "Borsa İstanbul 50 Endeksi",
        lastValue: 8950.15,
        change: 98.30,
        changePercent: 1.11,
      },
    }),
    prisma.index.create({
      data: {
        code: "XBANK",
        name: "BIST Banka",
        description: "Borsa İstanbul Banka Endeksi",
        lastValue: 15420.60,
        change: 280.40,
        changePercent: 1.85,
      },
    }),
  ]);

  console.log(`✅ Created ${indices.length} indices`);

  // Hisse Senetleri
  const stocksData = [
    {
      symbol: "THYAO",
      name: "Türk Hava Yolları A.O.",
      shortName: "THY",
      sectorId: sectors.find((s) => s.code === "XULAS")!.id,
      marketCap: 285000000000,
      lastPrice: 285.50,
      previousClose: 278.20,
      change: 7.30,
      changePercent: 2.62,
      dayHigh: 288.00,
      dayLow: 276.50,
      dayOpen: 279.00,
      volume: 45000000,
      turnover: 12800000000,
      week52High: 312.50,
      week52Low: 185.20,
      peRatio: 8.5,
      pbRatio: 1.8,
      freeFloat: 50.8,
      description: "Türkiye'nin bayrak taşıyıcı havayolu şirketi",
    },
    {
      symbol: "GARAN",
      name: "Türkiye Garanti Bankası A.Ş.",
      shortName: "Garanti BBVA",
      sectorId: sectors.find((s) => s.code === "XBANK")!.id,
      marketCap: 350000000000,
      lastPrice: 83.25,
      previousClose: 81.50,
      change: 1.75,
      changePercent: 2.15,
      dayHigh: 84.50,
      dayLow: 80.80,
      dayOpen: 81.80,
      volume: 120000000,
      turnover: 9950000000,
      week52High: 95.40,
      week52Low: 42.50,
      peRatio: 5.2,
      pbRatio: 0.95,
      freeFloat: 49.2,
      description: "Türkiye'nin önde gelen özel bankalarından biri",
    },
    {
      symbol: "ASELS",
      name: "Aselsan Elektronik Sanayi ve Ticaret A.Ş.",
      shortName: "ASELSAN",
      sectorId: sectors.find((s) => s.code === "XMESY")!.id,
      marketCap: 180000000000,
      lastPrice: 54.80,
      previousClose: 53.20,
      change: 1.60,
      changePercent: 3.01,
      dayHigh: 55.90,
      dayLow: 52.80,
      dayOpen: 53.50,
      volume: 85000000,
      turnover: 4650000000,
      week52High: 62.30,
      week52Low: 28.40,
      peRatio: 18.5,
      pbRatio: 3.2,
      freeFloat: 15.2,
      description: "Türkiye'nin en büyük savunma sanayi şirketi",
    },
    {
      symbol: "SISE",
      name: "Türkiye Şişe ve Cam Fabrikaları A.Ş.",
      shortName: "Şişecam",
      sectorId: sectors.find((s) => s.code === "XUSIN")!.id,
      marketCap: 125000000000,
      lastPrice: 48.90,
      previousClose: 49.50,
      change: -0.60,
      changePercent: -1.21,
      dayHigh: 50.20,
      dayLow: 48.40,
      dayOpen: 49.80,
      volume: 42000000,
      turnover: 2050000000,
      week52High: 58.75,
      week52Low: 32.10,
      peRatio: 6.8,
      pbRatio: 1.1,
      freeFloat: 35.6,
      description: "Cam ve kimyasal ürünler üreticisi",
    },
    {
      symbol: "KCHOL",
      name: "Koç Holding A.Ş.",
      shortName: "Koç Holding",
      sectorId: sectors.find((s) => s.code === "XHOLD")!.id,
      marketCap: 320000000000,
      lastPrice: 126.40,
      previousClose: 124.80,
      change: 1.60,
      changePercent: 1.28,
      dayHigh: 128.50,
      dayLow: 123.50,
      dayOpen: 125.00,
      volume: 28000000,
      turnover: 3520000000,
      week52High: 145.20,
      week52Low: 85.60,
      peRatio: 7.2,
      pbRatio: 1.45,
      freeFloat: 28.4,
      description: "Türkiye'nin en büyük sanayi holding şirketi",
    },
    {
      symbol: "SAHOL",
      name: "Hacı Ömer Sabancı Holding A.Ş.",
      shortName: "Sabancı Holding",
      sectorId: sectors.find((s) => s.code === "XHOLD")!.id,
      marketCap: 185000000000,
      lastPrice: 90.60,
      previousClose: 88.90,
      change: 1.70,
      changePercent: 1.91,
      dayHigh: 91.80,
      dayLow: 88.20,
      dayOpen: 89.00,
      volume: 35000000,
      turnover: 3150000000,
      week52High: 105.30,
      week52Low: 58.40,
      peRatio: 6.5,
      pbRatio: 1.25,
      freeFloat: 51.2,
      description: "Türkiye'nin önde gelen çeşitlendirilmiş holdinglerinden",
    },
    {
      symbol: "EREGL",
      name: "Ereğli Demir ve Çelik Fabrikaları T.A.Ş.",
      shortName: "Erdemir",
      sectorId: sectors.find((s) => s.code === "XUSIN")!.id,
      marketCap: 145000000000,
      lastPrice: 41.20,
      previousClose: 40.50,
      change: 0.70,
      changePercent: 1.73,
      dayHigh: 42.10,
      dayLow: 40.20,
      dayOpen: 40.60,
      volume: 55000000,
      turnover: 2260000000,
      week52High: 52.80,
      week52Low: 28.90,
      peRatio: 4.8,
      pbRatio: 0.85,
      freeFloat: 49.8,
      description: "Türkiye'nin en büyük yassı çelik üreticisi",
    },
    {
      symbol: "AKBNK",
      name: "Akbank T.A.Ş.",
      shortName: "Akbank",
      sectorId: sectors.find((s) => s.code === "XBANK")!.id,
      marketCap: 280000000000,
      lastPrice: 53.80,
      previousClose: 52.40,
      change: 1.40,
      changePercent: 2.67,
      dayHigh: 54.90,
      dayLow: 52.10,
      dayOpen: 52.50,
      volume: 95000000,
      turnover: 5100000000,
      week52High: 62.40,
      week52Low: 28.60,
      peRatio: 4.2,
      pbRatio: 0.78,
      freeFloat: 51.4,
      description: "Türkiye'nin önde gelen özel bankalarından",
    },
    {
      symbol: "TUPRS",
      name: "Tüpraş - Türkiye Petrol Rafinerileri A.Ş.",
      shortName: "Tüpraş",
      sectorId: sectors.find((s) => s.code === "XKMYA")!.id,
      marketCap: 195000000000,
      lastPrice: 155.20,
      previousClose: 152.80,
      change: 2.40,
      changePercent: 1.57,
      dayHigh: 157.50,
      dayLow: 151.40,
      dayOpen: 153.00,
      volume: 18000000,
      turnover: 2780000000,
      week52High: 178.60,
      week52Low: 98.50,
      peRatio: 5.5,
      pbRatio: 1.65,
      freeFloat: 48.9,
      description: "Türkiye'nin en büyük petrol rafinerisi",
    },
    {
      symbol: "TCELL",
      name: "Turkcell İletişim Hizmetleri A.Ş.",
      shortName: "Turkcell",
      sectorId: sectors.find((s) => s.code === "XILTM")!.id,
      marketCap: 165000000000,
      lastPrice: 74.90,
      previousClose: 73.50,
      change: 1.40,
      changePercent: 1.90,
      dayHigh: 75.80,
      dayLow: 73.20,
      dayOpen: 73.80,
      volume: 32000000,
      turnover: 2390000000,
      week52High: 88.50,
      week52Low: 48.20,
      peRatio: 9.2,
      pbRatio: 1.85,
      freeFloat: 34.5,
      description: "Türkiye'nin en büyük GSM operatörü",
    },
    {
      symbol: "BIMAS",
      name: "BİM Birleşik Mağazalar A.Ş.",
      shortName: "BİM",
      sectorId: sectors.find((s) => s.code === "XGIDA")!.id,
      marketCap: 220000000000,
      lastPrice: 362.50,
      previousClose: 358.00,
      change: 4.50,
      changePercent: 1.26,
      dayHigh: 368.00,
      dayLow: 355.00,
      dayOpen: 359.00,
      volume: 8500000,
      turnover: 3080000000,
      week52High: 420.00,
      week52Low: 245.00,
      peRatio: 22.5,
      pbRatio: 8.5,
      freeFloat: 42.8,
      description: "Türkiye'nin en büyük indirim market zinciri",
    },
    {
      symbol: "YKBNK",
      name: "Yapı ve Kredi Bankası A.Ş.",
      shortName: "Yapı Kredi",
      sectorId: sectors.find((s) => s.code === "XBANK")!.id,
      marketCap: 180000000000,
      lastPrice: 21.42,
      previousClose: 20.95,
      change: 0.47,
      changePercent: 2.24,
      dayHigh: 21.80,
      dayLow: 20.80,
      dayOpen: 21.00,
      volume: 150000000,
      turnover: 3200000000,
      week52High: 25.80,
      week52Low: 11.50,
      peRatio: 4.8,
      pbRatio: 0.72,
      freeFloat: 31.5,
      description: "Türkiye'nin büyük özel bankalarından",
    },
    {
      symbol: "FROTO",
      name: "Ford Otomotiv Sanayi A.Ş.",
      shortName: "Ford Otosan",
      sectorId: sectors.find((s) => s.code === "XMESY")!.id,
      marketCap: 285000000000,
      lastPrice: 812.50,
      previousClose: 798.00,
      change: 14.50,
      changePercent: 1.82,
      dayHigh: 825.00,
      dayLow: 795.00,
      dayOpen: 800.00,
      volume: 2800000,
      turnover: 2270000000,
      week52High: 950.00,
      week52Low: 520.00,
      peRatio: 8.8,
      pbRatio: 4.2,
      freeFloat: 18.2,
      description: "Türkiye'nin önde gelen otomotiv üreticisi",
    },
    {
      symbol: "TOASO",
      name: "Tofaş Türk Otomobil Fabrikası A.Ş.",
      shortName: "Tofaş",
      sectorId: sectors.find((s) => s.code === "XMESY")!.id,
      marketCap: 115000000000,
      lastPrice: 230.80,
      previousClose: 226.50,
      change: 4.30,
      changePercent: 1.90,
      dayHigh: 235.00,
      dayLow: 224.00,
      dayOpen: 227.00,
      volume: 6500000,
      turnover: 1490000000,
      week52High: 280.00,
      week52Low: 155.00,
      peRatio: 7.2,
      pbRatio: 2.8,
      freeFloat: 24.5,
      description: "Fiat ve Stellantis markalarının Türkiye üreticisi",
    },
    {
      symbol: "PGSUS",
      name: "Pegasus Hava Taşımacılığı A.Ş.",
      shortName: "Pegasus",
      sectorId: sectors.find((s) => s.code === "XULAS")!.id,
      marketCap: 85000000000,
      lastPrice: 832.00,
      previousClose: 815.00,
      change: 17.00,
      changePercent: 2.09,
      dayHigh: 845.00,
      dayLow: 810.00,
      dayOpen: 818.00,
      volume: 1800000,
      turnover: 1495000000,
      week52High: 980.00,
      week52Low: 485.00,
      peRatio: 6.5,
      pbRatio: 3.8,
      freeFloat: 34.8,
      description: "Türkiye'nin düşük maliyetli havayolu şirketi",
    },
  ];

  const stocks = await Promise.all(
    stocksData.map((data) =>
      prisma.stock.create({
        data: {
          ...data,
          sharesOutstanding: data.marketCap / data.lastPrice,
        },
      })
    )
  );

  console.log(`✅ Created ${stocks.length} stocks`);

  // Hisse-Endeks İlişkileri (BIST 100 ve BIST 30)
  const bist100 = indices.find((i) => i.code === "XU100")!;
  const bist30 = indices.find((i) => i.code === "XU030")!;

  // Tüm hisseler BIST 100'de
  await Promise.all(
    stocks.map((stock, index) =>
      prisma.stockIndex.create({
        data: {
          stockId: stock.id,
          indexId: bist100.id,
          weight: (15 - index) * 0.5, // Basit ağırlık hesaplaması
        },
      })
    )
  );

  // İlk 10 hisse BIST 30'da
  await Promise.all(
    stocks.slice(0, 10).map((stock, index) =>
      prisma.stockIndex.create({
        data: {
          stockId: stock.id,
          indexId: bist30.id,
          weight: (10 - index) * 1.2,
        },
      })
    )
  );

  console.log(`✅ Created stock-index relations`);

  // Fiyat Geçmişi (Son 30 gün)
  const today = new Date();
  for (const stock of stocks) {
    const priceHistories = [];
    let basePrice = stock.lastPrice;

    for (let i = 30; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);

      // Hafta sonu atla
      if (date.getDay() === 0 || date.getDay() === 6) continue;

      const randomChange = (Math.random() - 0.5) * 0.04; // ±2% günlük değişim
      const close = basePrice * (1 + randomChange);
      const high = close * (1 + Math.random() * 0.02);
      const low = close * (1 - Math.random() * 0.02);
      const open = (close + basePrice) / 2;

      priceHistories.push({
        stockId: stock.id,
        date: new Date(date.setHours(18, 0, 0, 0)),
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume: Math.floor(stock.volume * (0.8 + Math.random() * 0.4)),
        turnover: Math.floor(stock.turnover * (0.8 + Math.random() * 0.4)),
      });

      basePrice = close;
    }

    await prisma.priceHistory.createMany({ data: priceHistories });
  }

  console.log(`✅ Created price history for ${stocks.length} stocks`);

  // Haberler
  const newsData = [
    {
      title: "BIST 100 Endeksi Güçlü Yükselişle 10.000 Puanı Test Ediyor",
      summary:
        "Borsa İstanbul'da güçlü alımlar devam ederken BIST 100 endeksi 10.000 puan direncini test ediyor.",
      source: "Borsa İstanbul",
      category: "GENERAL",
      isImportant: true,
      publishedAt: new Date(),
    },
    {
      title: "THY, 2024 Yılında Rekor Yolcu Sayısına Ulaştı",
      summary:
        "Türk Hava Yolları, 2024 yılında 85 milyon yolcu taşıyarak yeni bir rekora imza attı.",
      source: "KAP",
      category: "ANNOUNCEMENT",
      isImportant: true,
      publishedAt: new Date(Date.now() - 86400000),
    },
    {
      title: "Bankacılık Sektöründe Temettü Beklentileri Artıyor",
      summary:
        "Bankalar, 2024 yılı karlarını açıklamaya başladı. Temettü dağıtım oranları yatırımcıların odağında.",
      source: "Reuters",
      category: "ANALYSIS",
      isImportant: false,
      publishedAt: new Date(Date.now() - 172800000),
    },
    {
      title: "ASELSAN, Yeni Savunma Projesi İmzaladı",
      summary:
        "ASELSAN, Savunma Sanayii Başkanlığı ile 2 milyar dolarlık yeni proje anlaşması imzaladı.",
      source: "KAP",
      category: "ANNOUNCEMENT",
      isImportant: true,
      publishedAt: new Date(Date.now() - 259200000),
    },
    {
      title: "Merkez Bankası Faiz Kararını Açıkladı",
      summary:
        "TCMB, politika faizini sabit tutarak piyasalarda beklentilere paralel hareket etti.",
      source: "TCMB",
      category: "GENERAL",
      isImportant: true,
      publishedAt: new Date(Date.now() - 345600000),
    },
  ];

  const createdNews = await Promise.all(
    newsData.map((data) => prisma.news.create({ data }))
  );

  // Bazı haberleri hisselerle ilişkilendir
  await prisma.stockNews.createMany({
    data: [
      {
        stockId: stocks.find((s) => s.symbol === "THYAO")!.id,
        newsId: createdNews[1].id,
      },
      {
        stockId: stocks.find((s) => s.symbol === "GARAN")!.id,
        newsId: createdNews[2].id,
      },
      {
        stockId: stocks.find((s) => s.symbol === "AKBNK")!.id,
        newsId: createdNews[2].id,
      },
      {
        stockId: stocks.find((s) => s.symbol === "ASELS")!.id,
        newsId: createdNews[3].id,
      },
    ],
  });

  console.log(`✅ Created ${createdNews.length} news articles`);

  // Piyasa Özet Verisi
  await prisma.marketSnapshot.create({
    data: {
      date: new Date(new Date().setHours(0, 0, 0, 0)),
      bist100Value: 9850.25,
      bist100Change: 1.29,
      bist100Volume: 85000000000,
      totalMarketCap: 12500000000000,
      totalVolume: 95000000000,
      advancers: 285,
      decliners: 142,
      unchanged: 48,
      usdTry: 32.85,
      eurTry: 35.65,
    },
  });

  console.log(`✅ Created market snapshot`);

  console.log("\n🎉 Seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

-- CreateTable
CREATE TABLE "Sector" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "iconUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Index" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "lastValue" REAL NOT NULL DEFAULT 0,
    "change" REAL NOT NULL DEFAULT 0,
    "changePercent" REAL NOT NULL DEFAULT 0,
    "volume" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Stock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "description" TEXT,
    "logoUrl" TEXT,
    "websiteUrl" TEXT,
    "sectorId" TEXT,
    "marketCap" REAL NOT NULL DEFAULT 0,
    "sharesOutstanding" REAL NOT NULL DEFAULT 0,
    "freeFloat" REAL NOT NULL DEFAULT 0,
    "lastPrice" REAL NOT NULL DEFAULT 0,
    "previousClose" REAL NOT NULL DEFAULT 0,
    "change" REAL NOT NULL DEFAULT 0,
    "changePercent" REAL NOT NULL DEFAULT 0,
    "dayHigh" REAL NOT NULL DEFAULT 0,
    "dayLow" REAL NOT NULL DEFAULT 0,
    "dayOpen" REAL NOT NULL DEFAULT 0,
    "volume" REAL NOT NULL DEFAULT 0,
    "turnover" REAL NOT NULL DEFAULT 0,
    "week52High" REAL NOT NULL DEFAULT 0,
    "week52Low" REAL NOT NULL DEFAULT 0,
    "peRatio" REAL,
    "pbRatio" REAL,
    "eps" REAL,
    "dividendYield" REAL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isTrading" BOOLEAN NOT NULL DEFAULT true,
    "lastTradeAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Stock_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockIndex" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "indexId" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockIndex_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockIndex_indexId_fkey" FOREIGN KEY ("indexId") REFERENCES "Index" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" REAL NOT NULL,
    "turnover" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "PriceHistory_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IndexPriceHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "indexId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "open" REAL NOT NULL,
    "high" REAL NOT NULL,
    "low" REAL NOT NULL,
    "close" REAL NOT NULL,
    "volume" REAL NOT NULL,
    CONSTRAINT "IndexPriceHistory_indexId_fkey" FOREIGN KEY ("indexId") REFERENCES "Index" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Dividend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "announcementDate" DATETIME NOT NULL,
    "exDividendDate" DATETIME,
    "paymentDate" DATETIME,
    "grossAmount" REAL NOT NULL,
    "netAmount" REAL,
    "dividendType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Dividend_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinancialStatement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "revenue" REAL,
    "netIncome" REAL,
    "totalAssets" REAL,
    "totalEquity" REAL,
    "totalDebt" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinancialStatement_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "News" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "content" TEXT,
    "source" TEXT,
    "sourceUrl" TEXT,
    "imageUrl" TEXT,
    "category" TEXT,
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StockNews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stockId" TEXT NOT NULL,
    "newsId" TEXT NOT NULL,
    CONSTRAINT "StockNews_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockNews_newsId_fkey" FOREIGN KEY ("newsId") REFERENCES "News" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "bist100Value" REAL NOT NULL,
    "bist100Change" REAL NOT NULL,
    "bist100Volume" REAL NOT NULL,
    "totalMarketCap" REAL NOT NULL,
    "totalVolume" REAL NOT NULL,
    "advancers" INTEGER NOT NULL DEFAULT 0,
    "decliners" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "usdTry" REAL,
    "eurTry" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Takip Listem',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "alertPrice" REAL,
    "note" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WatchlistItem_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Sector_code_key" ON "Sector"("code");

-- CreateIndex
CREATE INDEX "Sector_code_idx" ON "Sector"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Index_code_key" ON "Index"("code");

-- CreateIndex
CREATE INDEX "Index_code_idx" ON "Index"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Stock_symbol_key" ON "Stock"("symbol");

-- CreateIndex
CREATE INDEX "Stock_symbol_idx" ON "Stock"("symbol");

-- CreateIndex
CREATE INDEX "Stock_sectorId_idx" ON "Stock"("sectorId");

-- CreateIndex
CREATE INDEX "Stock_marketCap_idx" ON "Stock"("marketCap" DESC);

-- CreateIndex
CREATE INDEX "Stock_changePercent_idx" ON "Stock"("changePercent" DESC);

-- CreateIndex
CREATE INDEX "StockIndex_stockId_idx" ON "StockIndex"("stockId");

-- CreateIndex
CREATE INDEX "StockIndex_indexId_idx" ON "StockIndex"("indexId");

-- CreateIndex
CREATE UNIQUE INDEX "StockIndex_stockId_indexId_key" ON "StockIndex"("stockId", "indexId");

-- CreateIndex
CREATE INDEX "PriceHistory_stockId_date_idx" ON "PriceHistory"("stockId", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PriceHistory_stockId_date_key" ON "PriceHistory"("stockId", "date");

-- CreateIndex
CREATE INDEX "IndexPriceHistory_indexId_date_idx" ON "IndexPriceHistory"("indexId", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "IndexPriceHistory_indexId_date_key" ON "IndexPriceHistory"("indexId", "date");

-- CreateIndex
CREATE INDEX "Dividend_stockId_announcementDate_idx" ON "Dividend"("stockId", "announcementDate" DESC);

-- CreateIndex
CREATE INDEX "FinancialStatement_stockId_period_idx" ON "FinancialStatement"("stockId", "period" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "FinancialStatement_stockId_period_key" ON "FinancialStatement"("stockId", "period");

-- CreateIndex
CREATE INDEX "News_publishedAt_idx" ON "News"("publishedAt" DESC);

-- CreateIndex
CREATE INDEX "News_category_publishedAt_idx" ON "News"("category", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "StockNews_stockId_idx" ON "StockNews"("stockId");

-- CreateIndex
CREATE INDEX "StockNews_newsId_idx" ON "StockNews"("newsId");

-- CreateIndex
CREATE UNIQUE INDEX "StockNews_stockId_newsId_key" ON "StockNews"("stockId", "newsId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSnapshot_date_key" ON "MarketSnapshot"("date");

-- CreateIndex
CREATE INDEX "MarketSnapshot_date_idx" ON "MarketSnapshot"("date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Watchlist_userId_idx" ON "Watchlist"("userId");

-- CreateIndex
CREATE INDEX "WatchlistItem_watchlistId_idx" ON "WatchlistItem"("watchlistId");

-- CreateIndex
CREATE INDEX "WatchlistItem_stockId_idx" ON "WatchlistItem"("stockId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_stockId_key" ON "WatchlistItem"("watchlistId", "stockId");

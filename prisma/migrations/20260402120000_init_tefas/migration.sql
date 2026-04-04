-- CreateTable
CREATE TABLE "FundCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FundType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Fund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "description" TEXT,
    "logoUrl" TEXT,
    "categoryId" TEXT,
    "fundTypeId" TEXT,
    "portfolioSize" REAL NOT NULL DEFAULT 0,
    "investorCount" INTEGER NOT NULL DEFAULT 0,
    "shareCount" REAL NOT NULL DEFAULT 0,
    "lastPrice" REAL NOT NULL DEFAULT 0,
    "previousPrice" REAL NOT NULL DEFAULT 0,
    "dailyReturn" REAL NOT NULL DEFAULT 0,
    "weeklyReturn" REAL NOT NULL DEFAULT 0,
    "monthlyReturn" REAL NOT NULL DEFAULT 0,
    "yearlyReturn" REAL NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Fund_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FundCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Fund_fundTypeId_fkey" FOREIGN KEY ("fundTypeId") REFERENCES "FundType" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FundPriceHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fundId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "price" REAL NOT NULL,
    "dailyReturn" REAL NOT NULL DEFAULT 0,
    "portfolioSize" REAL NOT NULL DEFAULT 0,
    "investorCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "FundPriceHistory_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "totalFundCount" INTEGER NOT NULL DEFAULT 0,
    "totalPortfolioSize" REAL NOT NULL DEFAULT 0,
    "totalInvestorCount" INTEGER NOT NULL DEFAULT 0,
    "avgDailyReturn" REAL NOT NULL DEFAULT 0,
    "advancers" INTEGER NOT NULL DEFAULT 0,
    "decliners" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "usdTry" REAL,
    "eurTry" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "syncType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fundsUpdated" INTEGER NOT NULL DEFAULT 0,
    "fundsCreated" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "durationMs" INTEGER,
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
    "fundId" TEXT NOT NULL,
    "alertPrice" REAL,
    "note" TEXT,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WatchlistItem_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FundCategory_code_key" ON "FundCategory"("code");

-- CreateIndex
CREATE INDEX "FundCategory_code_idx" ON "FundCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FundType_code_key" ON "FundType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Fund_code_key" ON "Fund"("code");

-- CreateIndex
CREATE INDEX "Fund_portfolioSize_idx" ON "Fund"("portfolioSize" DESC);

-- CreateIndex
CREATE INDEX "Fund_dailyReturn_idx" ON "Fund"("dailyReturn" DESC);

-- CreateIndex
CREATE INDEX "FundPriceHistory_fundId_date_idx" ON "FundPriceHistory"("fundId", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "FundPriceHistory_fundId_date_key" ON "FundPriceHistory"("fundId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSnapshot_date_key" ON "MarketSnapshot"("date");

-- CreateIndex
CREATE INDEX "MarketSnapshot_date_idx" ON "MarketSnapshot"("date" DESC);

-- CreateIndex
CREATE INDEX "SyncLog_createdAt_idx" ON "SyncLog"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_fundId_key" ON "WatchlistItem"("watchlistId", "fundId");


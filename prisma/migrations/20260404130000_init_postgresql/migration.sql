-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."FundCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FundType" (
    "id" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Fund" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "description" TEXT,
    "logoUrl" TEXT,
    "categoryId" TEXT,
    "fundTypeId" TEXT,
    "portfolioSize" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "investorCount" INTEGER NOT NULL DEFAULT 0,
    "shareCount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "previousPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyReturn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weeklyReturn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyReturn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "yearlyReturn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FundPriceHistory" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "dailyReturn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "portfolioSize" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "investorCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FundPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MarketSnapshot" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalFundCount" INTEGER NOT NULL DEFAULT 0,
    "totalPortfolioSize" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalInvestorCount" INTEGER NOT NULL DEFAULT 0,
    "avgDailyReturn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "advancers" INTEGER NOT NULL DEFAULT 0,
    "decliners" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "usdTry" DOUBLE PRECISION,
    "eurTry" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SyncLog" (
    "id" TEXT NOT NULL,
    "syncType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fundsUpdated" INTEGER NOT NULL DEFAULT 0,
    "fundsCreated" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Watchlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Takip Listem',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WatchlistItem" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "alertPrice" DOUBLE PRECISION,
    "note" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FundCategory_code_key" ON "public"."FundCategory"("code");

-- CreateIndex
CREATE INDEX "FundCategory_code_idx" ON "public"."FundCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FundType_code_key" ON "public"."FundType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Fund_code_key" ON "public"."Fund"("code");

-- CreateIndex
CREATE INDEX "Fund_portfolioSize_idx" ON "public"."Fund"("portfolioSize" DESC);

-- CreateIndex
CREATE INDEX "Fund_dailyReturn_idx" ON "public"."Fund"("dailyReturn" DESC);

-- CreateIndex
CREATE INDEX "FundPriceHistory_fundId_date_idx" ON "public"."FundPriceHistory"("fundId", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "FundPriceHistory_fundId_date_key" ON "public"."FundPriceHistory"("fundId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSnapshot_date_key" ON "public"."MarketSnapshot"("date");

-- CreateIndex
CREATE INDEX "MarketSnapshot_date_idx" ON "public"."MarketSnapshot"("date" DESC);

-- CreateIndex
CREATE INDEX "SyncLog_createdAt_idx" ON "public"."SyncLog"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_fundId_key" ON "public"."WatchlistItem"("watchlistId", "fundId");

-- AddForeignKey
ALTER TABLE "public"."Fund" ADD CONSTRAINT "Fund_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."FundCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Fund" ADD CONSTRAINT "Fund_fundTypeId_fkey" FOREIGN KEY ("fundTypeId") REFERENCES "public"."FundType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FundPriceHistory" ADD CONSTRAINT "FundPriceHistory_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "public"."Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Watchlist" ADD CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WatchlistItem" ADD CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "public"."Watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WatchlistItem" ADD CONSTRAINT "WatchlistItem_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "public"."Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
